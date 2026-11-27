"""Prototype V2 serial controller for the TapTrack bench motor firmware.

This module provides protocol correlation, not authentication, durable replay
protection, physical position feedback, or production safety.
"""

from __future__ import annotations

import logging
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable


DEFAULT_BAUD_RATE = 115200
DEFAULT_RESPONSE_TIMEOUT_SECONDS = 10.0
DEFAULT_HANDSHAKE_ATTEMPTS = 3
HEALTH_POLL_SECONDS = 2.0
HEALTH_MAX_AGE_SECONDS = 3.0
OPEN_PRECHECK_SECONDS = 0.5
OPEN_REQUEST_EXPIRED = 'OPEN request expired before serial transmission.'
OPEN_STATUS_EXPIRED = 'OPEN safety STATUS expired before serial transmission.'
CLOSE_UNAVAILABLE = 'CLOSE unavailable in bench-test mode: BENCH_OPEN_ONLY.'
MAX_FRAME_BYTES = 96
MAX_TRANSACTION_ID = 0xFFFFFFFF
logger = logging.getLogger(__name__)

COMMANDS = {
    ('Station 1', 'OPEN'): '1',
    ('Station 1', 'CLOSE'): '2',
    ('Station 2', 'OPEN'): '3',
    ('Station 2', 'CLOSE'): '4',
}
VALID_REASONS = {'BUSY', 'BAD_COMMAND', 'STALE_SESSION', 'STALE_TRANSACTION', 'DUPLICATE_TRANSACTION'}
VALID_REASONS |= {'BENCH_OPEN_ONLY', 'STOP_LATCHED', 'TARGET_LIMIT_ACTIVE'}
SESSION_PATTERN = re.compile(r'^[0-9a-f]{16}$')
NONCE_PATTERN = re.compile(r'^[0-9a-f]{16}$')
TRANSACTION_PATTERN = re.compile(r'^[1-9][0-9]{0,9}$')


class MotorOutcome(str, Enum):
    BUSY = 'busy'
    COMPLETED = 'completed'
    REJECTED = 'rejected'
    UNCERTAIN = 'uncertain'


@dataclass(frozen=True)
class MotorCommandResult:
    station: str
    action: str
    command: str
    outcome: MotorOutcome
    session_id: str | None = None
    transaction_id: int | None = None
    command_transmitted: bool | None = False
    responses: tuple[str, ...] = ()
    error: str | None = None
    # Current HTTP request reused history or was inhibited before dispatch.
    dispatch_skipped: bool = False

    @property
    def accepted(self) -> bool:
        return any(',ACCEPTED,' in response for response in self.responses)

    @property
    def busy(self) -> bool:
        return self.outcome == MotorOutcome.BUSY or any(',BUSY,' in response for response in self.responses)


class _ProtocolError(ValueError):
    pass


class _RequestExpired(TimeoutError):
    pass


class SerialMotorController:
    """Serialize one V2 command through its matching terminal response."""

    def __init__(
        self,
        *,
        device: str | None = None,
        baud_rate: int | None = None,
        response_timeout: float | None = None,
        serial_instance=None,
        serial_factory: Callable | None = None,
    ) -> None:
        self.device = device or os.environ.get('TAPTRACK_MOTOR_SERIAL_DEVICE', '').strip()
        self.baud_rate = baud_rate if baud_rate is not None else int(
            os.environ.get('TAPTRACK_MOTOR_BAUD_RATE', str(DEFAULT_BAUD_RATE))
        )
        self.response_timeout = response_timeout if response_timeout is not None else float(
            os.environ.get('TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS', str(DEFAULT_RESPONSE_TIMEOUT_SECONDS))
        )
        if not self.device and serial_instance is None and serial_factory is None:
            raise ValueError('A serial device path is required.')
        if self.baud_rate <= 0 or not math.isfinite(self.response_timeout) or self.response_timeout <= 0:
            raise ValueError('Baud rate and response timeout must be positive.')

        self._serial = serial_instance
        self._serial_factory = serial_factory
        self._lock = threading.Lock()
        self._session_id: str | None = None
        self._next_transaction_id = 1
        # No persistent journal exists; every new process starts disarmed.
        self._unknown = True
        self._closed = False
        self._communication_ready = False
        self._connection_state = 'disconnected'
        self._safety = None
        self._health_checked_at: float | None = None
        self._fault_session_id = None
        self._recovery_reason = 'Physical position is unknown after service startup; operator recovery is required.'
        self._stop = threading.Event()
        self._worker = None

    def start(self) -> None:
        """Start communication only. This never arms or dispatches a command."""
        with self._lock:
            if self._worker is not None or self._closed:
                return
            self._worker = threading.Thread(target=self._connection_loop, name='motor-connection', daemon=True)
            self._worker.start()

    def _connection_loop(self) -> None:
        delays = (1, 2, 4, 8, 15)
        attempt = 0
        while not self._stop.is_set():
            if not self._lock.acquire(blocking=False):
                self._stop.wait(0.1)
                continue
            try:
                if self._closed:
                    return
                connected = self._connect_locked()
            finally:
                self._lock.release()
            delay = HEALTH_POLL_SECONDS if connected else delays[min(attempt, len(delays) - 1)]
            attempt = 0 if connected else attempt + 1
            self._stop.wait(delay)

    def _latch(self, reason: str) -> None:
        if not self._unknown or self._fault_session_id is None:
            self._fault_session_id = self._session_id
        self._unknown = True
        self._recovery_reason = reason

    def _latch_stop(self, reason: str) -> None:
        if self._safety is not None:
            self._safety['stop_latched'] = True
        self._latch(reason)

    def _disconnect(self) -> None:
        if not self._unknown:
            self._latch('Serial connection lost; manual safety recovery required.')
        self._communication_ready = False
        self._connection_state = 'disconnected'
        self._safety = None
        self._health_checked_at = None
        port, self._serial = self._serial, None
        if port is not None:
            try:
                port.close()
            except Exception:
                logger.warning('motor_serial_close_failed', exc_info=True)

    def _read_safety(self, port, session: str, *, deadline: float | None = None) -> dict:
        nonce = secrets.token_hex(8)
        self._write_frame(port, f'STATUS,2,{nonce}\n'.encode('ascii'), deadline=deadline)
        read_deadline = time.monotonic() + self.response_timeout if deadline is None else deadline
        fields = self._decode_fields(self._read_frame(port, read_deadline))
        if (len(fields) != 10 or fields[:2] != ['STATE', '2']
                or fields[2:4] != [session, nonce] or fields[9] != 'BENCH_OPEN_ONLY'
                or fields[5] not in ('IDLE', 'MOVING', 'DRAINING')
                or any(value not in ('0', '1') for value in fields[6:9])
                or not (TRANSACTION_PATTERN.fullmatch(fields[4]) or fields[4] == '0')
                or int(fields[4]) > MAX_TRANSACTION_ID):
            raise _ProtocolError('Missing, incompatible, or uncorrelated OPEN-only safety status.')
        return dict(last_transaction=int(fields[4]), motion=fields[5],
                    stop_latched=fields[6] == '1',
                    open_inputs={'Station 1': fields[7] == '1', 'Station 2': fields[8] == '1'})

    def _connect_locked(self) -> bool:
        self._connection_state = 'connecting'
        try:
            port = self._get_serial()
            self._ensure_no_pending_input(port)
            session, last, motion = self._handshake(port, attempts=DEFAULT_HANDSHAKE_ATTEMPTS)
            safety = self._read_safety(port, session)
            if safety['last_transaction'] != last or safety['motion'] != motion:
                raise _ProtocolError('ESP32 state changed during status exchange.')
            if self._session_id is not None and (
                    session != self._session_id or last != self._next_transaction_id - 1):
                self._latch('ESP32 session or transaction history changed; safety recovery required.')
            self._session_id = session
            self._next_transaction_id = last + 1
            if self._unknown and self._fault_session_id is None:
                self._fault_session_id = session
            self._safety = safety
            self._health_checked_at = time.monotonic()
            if safety['stop_latched']:
                self._latch('Emergency stop circuit open or stop latched: STOP_LATCHED.')
            elif motion != 'IDLE' or last >= MAX_TRANSACTION_ID:
                self._latch('ESP32 not safely idle or transaction IDs exhausted; safety recovery required.')
            self._communication_ready = True
            self._connection_state = 'connected'
            return True
        except Exception as error:
            if isinstance(error, _ProtocolError):
                self._latch(str(error))
            self._disconnect()
            logger.warning('motor_connection_retry reason=%s', error)
            return False

    def status_snapshot(self) -> dict:
        # Only publish cached state; HTTP status calls never wait for serial I/O.
        safety = self._safety if self._communication_ready else None
        return {
            'communication_ready': self._communication_ready,
            'safety_recovery_required': self._unknown,
            'recovery_reason': self._recovery_reason if self._unknown else None,
            'bench_mode': 'open_only', 'close_available': False,
            'stop_latched': safety['stop_latched'] if safety else None,
            'open_inputs': dict(safety['open_inputs']) if safety else None,
            'physical_movement_verified': False,
        }

    def command(self, station: str, action: str, *, deadline: float | None = None) -> MotorCommandResult:
        command = self._resolve_command(station, action)
        normalized_action = action.strip().upper()
        if normalized_action == 'CLOSE':
            return self._result(station, normalized_action, '', MotorOutcome.REJECTED, error=CLOSE_UNAVAILABLE)
        if deadline is None:
            deadline = time.monotonic() + OPEN_PRECHECK_SECONDS
        if time.monotonic() >= deadline:
            return self._result(station, normalized_action, command, MotorOutcome.REJECTED, error=OPEN_REQUEST_EXPIRED)
        if not self._lock.acquire(blocking=False):
            return MotorCommandResult(
                station, normalized_action, command, MotorOutcome.BUSY,
                error='Another motor request is in progress.',
            )

        try:
            transaction_id = self._next_transaction_id
            write_started = False
            command_transmitted = False
            if self._unknown or self._closed:
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    command_transmitted=False,
                    error=self._recovery_reason or 'Explicit operator recovery is required.',
                )
            if transaction_id > MAX_TRANSACTION_ID:
                self._latch('Transaction ID space exhausted; safety recovery required.')
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    error='Transaction ID space exhausted for this controller instance.',
                )

            responses: list[str] = []
            try:
                serial_port = self._serial
                if not self._communication_ready or serial_port is None or not serial_port.is_open:
                    raise _ProtocolError('Serial connection is unavailable; operator recovery is required.')
                now = time.monotonic()
                if self._health_checked_at is None or now - self._health_checked_at >= HEALTH_MAX_AGE_SECONDS:
                    return self._result(station, normalized_action, command, MotorOutcome.REJECTED,
                                        error='Controller health is stale. No command was sent.')
                self._ensure_no_pending_input(serial_port)
                # A bounded, single status check catches input changes since the worker poll.
                # OPEN never opens a port or performs a HELLO handshake.
                status_deadline = now + min(self.response_timeout, OPEN_PRECHECK_SECONDS)
                safety = self._read_safety(serial_port, self._session_id, deadline=min(deadline, status_deadline))
                self._safety = safety
                if safety['stop_latched']:
                    self._latch_stop('Emergency stop circuit open or stop latched: STOP_LATCHED.')
                    return self._result(station, normalized_action, command, MotorOutcome.REJECTED,
                                        error=self._recovery_reason)
                if safety['motion'] != 'IDLE' or safety['last_transaction'] != transaction_id - 1:
                    raise _ProtocolError('ESP32 motion or transaction history changed; operator recovery is required.')
                if safety['open_inputs'][station]:
                    return self._result(station, normalized_action, command, MotorOutcome.REJECTED,
                                        error='OPEN limit active or disconnected: TARGET_LIMIT_ACTIVE.')

                self._ensure_no_pending_input(serial_port)
                frame = f'CMD,2,{self._session_id},{transaction_id},{command}\n'.encode('ascii')
                write_started = True
                self._write_frame(serial_port, frame, deadline=min(deadline, status_deadline))
                command_transmitted = True
                self._next_transaction_id += 1
                outcome = self._read_transaction_responses(
                    serial_port, self._session_id, transaction_id, command, responses,
                )
                return self._result(
                    station, normalized_action, command, outcome,
                    transaction_id=transaction_id, responses=responses,
                    command_transmitted=True,
                    error=self._recovery_reason if self._unknown else (
                        responses[-1].split(',')[-1] if outcome == MotorOutcome.REJECTED else None),
                )
            except _RequestExpired:
                reason = OPEN_REQUEST_EXPIRED if time.monotonic() >= deadline else OPEN_STATUS_EXPIRED
                return self._result(station, normalized_action, command, MotorOutcome.REJECTED, error=reason)
            except Exception as error:
                self._latch(str(error) or 'Interrupted movement; safety recovery required.')
                self._disconnect()
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    transaction_id=transaction_id if write_started else None,
                    responses=responses,
                    command_transmitted=(
                        None if write_started and not command_transmitted else command_transmitted
                    ),
                    error=str(error) or 'Serial command outcome is unknown.',
                )
        finally:
            self._lock.release()

    def recover(
        self,
        *,
        operator_confirmed_driver_power_isolated: bool = False,
        operator_confirmed_stationary: bool = False,
        operator_confirmed_esp32_power_cycled: bool = False,
    ) -> bool:
        """Reconnect without movement after explicit operator safety confirmation.

        This is process-local only. A restarted process has no transaction
        journal and therefore requires this full physical recovery procedure;
        this method cannot reconcile prior movement or prove position.
        """
        if (
            operator_confirmed_driver_power_isolated is not True
            or operator_confirmed_stationary is not True
            or operator_confirmed_esp32_power_cycled is not True
        ):
            logger.warning('motor_serial_recovery_refused reason=operator_confirmations_incomplete')
            return False
        if not self._lock.acquire(blocking=False):
            logger.warning('motor_serial_recovery_refused reason=controller_busy')
            return False

        try:
            if not self._unknown or self._closed:
                logger.warning(
                    'motor_serial_recovery_refused reason=controller_not_recoverable closed=%s',
                    self._closed,
                )
                return False
            previous_session_id = self._fault_session_id or self._session_id
            try:
                if self._session_id is not None or self._fault_session_id is not None:
                    self._disconnect()
                serial_port = self._get_serial()
                new_session_id, last_transaction_id, device_state = self._handshake(serial_port)
                safety = self._read_safety(serial_port, new_session_id)
                if (safety['motion'] != device_state or safety['last_transaction'] != last_transaction_id
                        or safety['stop_latched'] or any(safety['open_inputs'].values())):
                    raise _ProtocolError('Safety inputs are not healthy; recovery remains locked.')
                if device_state != 'IDLE':
                    raise _ProtocolError('ESP32 is not idle; recovery remains locked.')
                if previous_session_id is not None and new_session_id == previous_session_id:
                    raise _ProtocolError('Recovery requires a new ESP32 session ID.')
                if last_transaction_id != 0:
                    raise _ProtocolError('Recovery requires a fresh ESP32 boot with zero prior transactions.')
            except Exception as error:
                self._unknown = True
                self._disconnect()
                logger.exception(
                    'motor_serial_recovery_failed error_type=%s reason=%s',
                    type(error).__name__,
                    error,
                )
                return False

            self._session_id = new_session_id
            self._next_transaction_id = last_transaction_id + 1
            self._unknown = False
            self._fault_session_id = None
            self._recovery_reason = None
            self._safety = safety
            self._health_checked_at = time.monotonic()
            self._communication_ready = True
            self._connection_state = 'connected'
            return True
        finally:
            self._lock.release()

    def close(self) -> None:
        self._stop.set()
        if self._worker is not None and self._worker is not threading.current_thread():
            self._worker.join(timeout=DEFAULT_HANDSHAKE_ATTEMPTS * self.response_timeout + 3)
        with self._lock:
            self._closed = True
            self._disconnect()

    @property
    def connection_status(self) -> str:
        if self._closed:
            return 'closed'
        return self._connection_state

    @property
    def armed(self) -> bool:
        return not self._unknown and not self._closed and self._communication_ready

    def _get_serial(self):
        if self._serial is not None:
            return self._serial
        if self._serial_factory is None:
            import serial

            factory = serial.Serial
        else:
            factory = self._serial_factory

        port = factory(port=None, baudrate=self.baud_rate, timeout=self.response_timeout)
        try:
            port.write_timeout = self.response_timeout
            if os.name == 'posix':
                port.exclusive = True
            port.dtr = False
            port.rts = False
            port.port = self.device
            logger.info(
                'motor_serial_connection status=connecting device=%s baud_rate=%s',
                os.path.basename(self.device),
                self.baud_rate,
            )
            port.open()
            if self._serial_factory is None:
                # Allow ESP32-S3 ROM startup output to finish before HELLO.
                time.sleep(1.0)
                port.reset_input_buffer()
        except Exception:
            try:
                port.close()
            except Exception:
                pass
            logger.exception(
                'motor_serial_connection status=failed device=%s',
                os.path.basename(self.device),
            )
            raise
        self._serial = port
        logger.info(
            'motor_serial_connection status=connected device=%s',
            os.path.basename(self.device),
        )
        return port

    def _handshake(self, serial_port, *, attempts: int = 1) -> tuple[str, int, str]:
        for _ in range(attempts):
            nonce = secrets.token_hex(8)
            self._write_frame(serial_port, f'HELLO,2,{nonce}\n'.encode('ascii'))
            deadline = time.monotonic() + self.response_timeout
            try:
                raw = self._read_frame(serial_port, deadline)
            except TimeoutError:
                continue

            fields = self._decode_fields(raw)
            if len(fields) != 6 or fields[:2] != ['READY', '2']:
                raise _ProtocolError('Expected READY,2,<session>,<nonce>,<last_transaction>,<state>.')
            session_id, echoed_nonce, last_transaction_text, device_state = fields[2:]
            if not SESSION_PATTERN.fullmatch(session_id) or not NONCE_PATTERN.fullmatch(echoed_nonce):
                raise _ProtocolError('READY contains an invalid session ID or nonce.')
            if echoed_nonce != nonce:
                raise _ProtocolError('READY nonce does not match this handshake.')
            if not TRANSACTION_PATTERN.fullmatch(last_transaction_text) and last_transaction_text != '0':
                raise _ProtocolError('READY transaction high-water mark is malformed.')
            if device_state not in ('IDLE', 'MOVING', 'DRAINING'):
                raise _ProtocolError('READY motor state is invalid.')
            if int(last_transaction_text) > MAX_TRANSACTION_ID:
                raise _ProtocolError('READY transaction high-water mark is out of range.')
            return session_id, int(last_transaction_text), device_state
        raise TimeoutError('Timed out waiting for a correlated V2 READY response.')

    def _read_transaction_responses(
        self,
        serial_port,
        session_id: str,
        transaction_id: int,
        command: str,
        responses: list[str],
    ) -> MotorOutcome:
        expected_statuses = ('ACCEPTED', 'BUSY', 'DONE')
        deadline = time.monotonic() + self.response_timeout
        expected_index = 0

        while expected_index < len(expected_statuses):
            raw = self._read_frame(serial_port, deadline)
            fields = self._decode_fields(raw)
            if fields[:2] == ['ERR', '2']:
                raise _ProtocolError('ESP32 reported a protocol error during a command.')
            if len(fields) not in (6, 7) or fields[:2] != ['RSP', '2']:
                raise _ProtocolError('Unexpected frame while waiting for command response.')

            _, _, response_session, response_transaction, status, response_command = fields[:6]
            if response_session != session_id:
                raise _ProtocolError('Response belongs to a different ESP32 session.')
            if not TRANSACTION_PATTERN.fullmatch(response_transaction):
                raise _ProtocolError('Response transaction ID is malformed.')
            if int(response_transaction) != transaction_id or response_command != command:
                raise _ProtocolError('Response does not match the active transaction.')

            if status == 'REJECTED':
                if expected_index != 0 or len(fields) != 7 or fields[6] not in VALID_REASONS:
                    raise _ProtocolError('REJECTED is malformed or arrived after acceptance.')
                responses.append(raw.decode('ascii').rstrip('\n'))
                if fields[6] == 'BUSY':
                    return MotorOutcome.BUSY
                if fields[6] in ('BAD_COMMAND', 'BENCH_OPEN_ONLY', 'TARGET_LIMIT_ACTIVE'):
                    return MotorOutcome.REJECTED
                if fields[6] == 'STOP_LATCHED':
                    self._latch_stop('Emergency stop circuit open or stop latched: STOP_LATCHED.')
                    return MotorOutcome.REJECTED
                raise _ProtocolError(f'Unexpected ESP32 rejection: {fields[6]}.')

            if status == 'ABORTED':
                if expected_index != 2 or len(fields) != 7 or fields[6] not in ('STOP_LATCHED', 'LIMIT_INPUT_OPEN'):
                    raise _ProtocolError('Malformed or out-of-order safety abort.')
                responses.append(raw.decode('ascii').rstrip('\n'))
                reason = f'Movement aborted: {fields[6]}; safety recovery required.'
                if fields[6] == 'STOP_LATCHED':
                    self._latch_stop(reason)
                else:
                    self._latch(reason)
                return MotorOutcome.UNCERTAIN
            if len(fields) != 6 or status != expected_statuses[expected_index]:
                raise _ProtocolError('Response status is invalid or out of order.')
            responses.append(raw.decode('ascii').rstrip('\n'))
            expected_index += 1

        return MotorOutcome.COMPLETED

    def _read_frame(self, serial_port, deadline: float) -> bytes:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Timed out waiting for ESP32 response.')
        serial_port.timeout = remaining
        raw = serial_port.read_until(b'\n', size=MAX_FRAME_BYTES + 1)
        if not raw or time.monotonic() >= deadline:
            raise TimeoutError('Timed out waiting for ESP32 response.')
        if len(raw) > MAX_FRAME_BYTES:
            raise _ProtocolError('ESP32 frame exceeds the maximum frame length.')
        if not raw.endswith(b'\n'):
            raise _ProtocolError('ESP32 frame is partial or missing LF termination.')
        return raw

    @staticmethod
    def _ensure_no_pending_input(serial_port) -> None:
        if int(serial_port.in_waiting) != 0:
            raise _ProtocolError('Unsolicited serial input is pending before command transmission.')

    @staticmethod
    def _decode_fields(raw: bytes) -> list[str]:
        if len(raw) > MAX_FRAME_BYTES or not raw.endswith(b'\n') or b'\r' in raw:
            raise _ProtocolError('Frame violates V2 length or LF framing rules.')
        try:
            text = raw[:-1].decode('ascii')
        except UnicodeDecodeError as error:
            raise _ProtocolError('Frame contains non-ASCII bytes.') from error
        fields = text.split(',')
        if any(not field for field in fields):
            raise _ProtocolError('Frame contains an empty field.')
        return fields

    @staticmethod
    def _write_frame(serial_port, frame: bytes, *, deadline: float | None = None) -> None:
        if len(frame) > MAX_FRAME_BYTES or not frame.endswith(b'\n') or b'\r' in frame:
            raise _ProtocolError('Refusing to write an invalid V2 frame.')
        if deadline is None:
            written = serial_port.write(frame)
        else:
            previous_timeout = serial_port.write_timeout
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _RequestExpired(OPEN_REQUEST_EXPIRED)
            try:
                serial_port.write_timeout = remaining if previous_timeout is None else min(remaining, previous_timeout)
                if time.monotonic() >= deadline:
                    raise _RequestExpired(OPEN_REQUEST_EXPIRED)
                written = serial_port.write(frame)
            finally:
                serial_port.write_timeout = previous_timeout
        if written != len(frame):
            raise OSError('Serial write was incomplete; command will not be retried.')
        # Reading the correlated response confirms delivery without a separate
        # blocking terminal drain that can outlive the configured write timeout.

    def _result(
        self,
        station: str,
        action: str,
        command: str,
        outcome: MotorOutcome,
        *,
        transaction_id: int | None = None,
        command_transmitted: bool | None = False,
        responses: list[str] | tuple[str, ...] = (),
        error: str | None = None,
    ) -> MotorCommandResult:
        return MotorCommandResult(
            station=station,
            action=action,
            command=command,
            outcome=outcome,
            session_id=self._session_id,
            transaction_id=transaction_id,
            command_transmitted=command_transmitted,
            responses=tuple(responses),
            error=error,
        )

    @staticmethod
    def _resolve_command(station: str, action: str) -> str:
        if not isinstance(station, str) or not isinstance(action, str):
            raise ValueError('Station and action must be strings.')
        normalized_action = action.strip().upper()
        if station not in ('Station 1', 'Station 2') or normalized_action not in ('OPEN', 'CLOSE'):
            raise ValueError('Station must be Station 1 or Station 2 and action must be OPEN or CLOSE.')
        return COMMANDS[(station, normalized_action)]
