"""Prototype V2 serial controller for the TapTrack bench motor firmware.

This module provides protocol correlation, not authentication, durable replay
protection, physical position feedback, or production safety.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable


DEFAULT_SERIAL_DEVICE = '/dev/ttyUSB0'
DEFAULT_BAUD_RATE = 115200
DEFAULT_RESPONSE_TIMEOUT_SECONDS = 10.0
DEFAULT_HANDSHAKE_ATTEMPTS = 3
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

    @property
    def accepted(self) -> bool:
        return any(',ACCEPTED,' in response for response in self.responses)

    @property
    def busy(self) -> bool:
        return self.outcome == MotorOutcome.BUSY or any(',BUSY,' in response for response in self.responses)


class _ProtocolError(ValueError):
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
        self.device = device or os.environ.get('TAPTRACK_MOTOR_SERIAL_DEVICE', DEFAULT_SERIAL_DEVICE)
        self.baud_rate = baud_rate if baud_rate is not None else int(
            os.environ.get('TAPTRACK_MOTOR_BAUD_RATE', str(DEFAULT_BAUD_RATE))
        )
        self.response_timeout = response_timeout if response_timeout is not None else float(
            os.environ.get('TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS', str(DEFAULT_RESPONSE_TIMEOUT_SECONDS))
        )
        if not self.device:
            raise ValueError('A serial device path is required.')
        if self.baud_rate <= 0 or self.response_timeout <= 0:
            raise ValueError('Baud rate and response timeout must be positive.')

        self._serial = serial_instance
        self._serial_factory = serial_factory
        self._lock = threading.Lock()
        self._session_id: str | None = None
        self._next_transaction_id = 1
        # No persistent journal exists; every new process starts disarmed.
        self._unknown = True
        self._closed = False

    def command(self, station: str, action: str) -> MotorCommandResult:
        command = self._resolve_command(station, action)
        normalized_action = action.strip().upper()
        if not self._lock.acquire(blocking=False):
            return MotorCommandResult(
                station, normalized_action, command, MotorOutcome.BUSY,
                error='Another motor request is in progress.',
            )

        try:
            transaction_id = self._next_transaction_id
            transmitted_transaction_id = None
            write_started = False
            command_transmitted = False
            if self._unknown or self._closed:
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    command_transmitted=False,
                    error='Motor outcome is uncertain; explicit operator recovery is required.',
                )
            if transaction_id > MAX_TRANSACTION_ID:
                self._unknown = True
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    error='Transaction ID space exhausted for this controller instance.',
                )

            responses: list[str] = []
            try:
                serial_port = self._get_serial()
                if self._session_id is None:
                    raise _ProtocolError('Operator recovery is required before movement is enabled.')

                self._ensure_no_pending_input(serial_port)
                current_transaction = self._next_transaction_id
                self._next_transaction_id += 1
                transmitted_transaction_id = current_transaction
                frame = f'CMD,2,{self._session_id},{current_transaction},{command}\n'.encode('ascii')
                write_started = True
                self._write_frame(serial_port, frame)
                command_transmitted = True
                outcome = self._read_transaction_responses(
                    serial_port, self._session_id, current_transaction, command, responses,
                )
                return self._result(
                    station, normalized_action, command, outcome,
                    transaction_id=current_transaction, responses=responses,
                    command_transmitted=True,
                )
            except Exception as error:
                self._unknown = True
                return self._result(
                    station, normalized_action, command, MotorOutcome.UNCERTAIN,
                    transaction_id=transmitted_transaction_id,
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
            previous_session_id = self._session_id
            try:
                if previous_session_id is not None and self._serial is not None:
                    self._serial.close()
                    self._serial = None
                serial_port = self._get_serial()
                new_session_id, last_transaction_id, device_state = self._handshake(serial_port)
                if device_state != 'IDLE':
                    raise _ProtocolError('ESP32 is not idle; recovery remains locked.')
                if previous_session_id is not None and new_session_id == previous_session_id:
                    raise _ProtocolError('Recovery requires a new ESP32 session ID.')
                if last_transaction_id >= MAX_TRANSACTION_ID:
                    raise _ProtocolError('ESP32 transaction ID space is exhausted for this session.')
            except Exception as error:
                self._unknown = True
                self._session_id = previous_session_id
                logger.exception(
                    'motor_serial_recovery_failed error_type=%s reason=%s',
                    type(error).__name__,
                    error,
                )
                return False

            self._session_id = new_session_id
            self._next_transaction_id = last_transaction_id + 1
            self._unknown = False
            return True
        finally:
            self._lock.release()

    def close(self) -> None:
        with self._lock:
            self._closed = True
            if self._serial is not None:
                self._serial.close()
                logger.info(
                    'motor_serial_connection status=closed device=%s',
                    os.path.basename(self.device),
                )

    @property
    def connection_status(self) -> str:
        if self._closed:
            return 'closed'
        return 'connected' if self._serial is not None else 'disconnected'

    @property
    def armed(self) -> bool:
        return not self._unknown and not self._closed and self._session_id is not None

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
            port.dtr = False
            port.rts = False
            port.port = self.device
            logger.info(
                'motor_serial_connection status=connecting device=%s baud_rate=%s',
                os.path.basename(self.device),
                self.baud_rate,
            )
            port.open()
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

    def _handshake(self, serial_port) -> tuple[str, int, str]:
        for _ in range(DEFAULT_HANDSHAKE_ATTEMPTS):
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
                if fields[6] == 'BAD_COMMAND':
                    return MotorOutcome.REJECTED
                else:
                    self._unknown = True
                    raise _ProtocolError(f'Unexpected ESP32 rejection: {fields[6]}.')

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
        if not raw:
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
    def _write_frame(serial_port, frame: bytes) -> None:
        if len(frame) > MAX_FRAME_BYTES or not frame.endswith(b'\n') or b'\r' in frame:
            raise _ProtocolError('Refusing to write an invalid V2 frame.')
        written = serial_port.write(frame)
        if written != len(frame):
            raise OSError('Serial write was incomplete; command will not be retried.')
        serial_port.flush()

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