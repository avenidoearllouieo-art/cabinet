"""No physical serial access: exercise Phase 1 with deterministic serial doubles."""
import threading
import unittest
from collections import deque
from unittest.mock import patch

from motor_controller import (
    HEALTH_MAX_AGE_SECONDS, MAX_FRAME_BYTES, MAX_TRANSACTION_ID, OPEN_REQUEST_EXPIRED, OPEN_STATUS_EXPIRED,
    MotorOutcome, SerialMotorController,
)
from test_motor_controller import FakeSerial, SerialFactory, SESSION, NEW_SESSION, response


CONFIRMATIONS = dict(operator_confirmed_driver_power_isolated=True,
                     operator_confirmed_stationary=True,
                     operator_confirmed_esp32_power_cycled=True)


class ConnectionTests(unittest.TestCase):
    def controller(self, port=None, factory=None):
        # Protocol tests use production timing. Expiry tests advance a fake clock.
        return SerialMotorController(device='/dev/serial/by-id/mock-bench',
                                     serial_instance=port, serial_factory=factory)

    def connect(self, controller):
        with controller._lock:
            return controller._connect_locked()

    def test_expiry_at_serial_write_preparation_never_writes_cmd(self):
        class SlowWriteSetupSerial(FakeSerial):
            @property
            def write_timeout(self):
                return self._write_timeout

            @write_timeout.setter
            def write_timeout(self, value):
                self._write_timeout = value
                if value is not None and any(frame.startswith(b'STATUS,') for frame in self.writes):
                    if len(self.writes) == 3:
                        clock.return_value = 105.0

        port = SlowWriteSetupSerial()
        controller = self.controller(port)
        with patch('motor_controller.time.monotonic', return_value=100.0) as clock:
            self.assertTrue(controller.recover(**CONFIRMATIONS))
            result = controller.command('Station 1', 'OPEN', deadline=105.0)
        self.assertEqual(result.error, OPEN_REQUEST_EXPIRED)
        self.assertIs(result.command_transmitted, False)
        self.assertEqual(controller._next_transaction_id, 1)
        self.assertEqual([frame.split(b',')[0] for frame in port.writes], [b'HELLO', b'STATUS', b'STATUS'])

    def test_status_response_at_600_ms_sends_no_cmd(self):
        class LateStatusSerial(FakeSerial):
            def read_until(self, *args, **kwargs):
                frame = super().read_until(*args, **kwargs)
                if frame.startswith(b'STATE,') and len(self.writes) == 3:
                    clock.return_value = 100.6
                return frame

        port = LateStatusSerial()
        controller = SerialMotorController(serial_instance=port, response_timeout=10)
        with patch('motor_controller.time.monotonic', return_value=100.0) as clock:
            self.assertTrue(controller.recover(**CONFIRMATIONS))
            result = controller.command('Station 1', 'OPEN', deadline=110.0)
        self.assertIs(result.command_transmitted, False)
        self.assertFalse(controller.armed)
        self.assertIn('Timed out', result.error)
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in port.writes))

    def test_status_freshness_expires_during_cmd_preparation(self):
        class SlowCommandSetupSerial(FakeSerial):
            @property
            def write_timeout(self):
                return self._write_timeout

            @write_timeout.setter
            def write_timeout(self, value):
                self._write_timeout = value
                if value is not None and len(self.writes) == 3:
                    clock.return_value = 100.6

        port = SlowCommandSetupSerial()
        controller = SerialMotorController(serial_instance=port, response_timeout=10)
        with patch('motor_controller.time.monotonic', return_value=100.0) as clock:
            self.assertTrue(controller.recover(**CONFIRMATIONS))
            result = controller.command('Station 1', 'OPEN', deadline=110.0)
        self.assertEqual(result.error, OPEN_STATUS_EXPIRED)
        self.assertIs(result.command_transmitted, False)
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in port.writes))

    def test_busy_serial_lock_does_not_queue_and_expired_request_cannot_send(self):
        port = FakeSerial()
        controller = self.controller(port)
        with patch('motor_controller.time.monotonic', return_value=100.0) as clock:
            self.assertTrue(controller.recover(**CONFIRMATIONS))
            before = list(port.writes)
            with controller._lock:
                self.assertEqual(controller.command('Station 1', 'OPEN', deadline=101).outcome, MotorOutcome.BUSY)
                clock.return_value = 101.0
            result = controller.command('Station 1', 'OPEN', deadline=101.0)
        self.assertEqual(result.error, OPEN_REQUEST_EXPIRED)
        self.assertEqual(port.writes, before)

    def test_stale_or_disconnected_transport_never_probes_in_request(self):
        for transport in ('stale', 'disconnected'):
            with self.subTest(transport=transport), patch('motor_controller.time.monotonic', return_value=100.0) as clock:
                port = FakeSerial()
                controller = self.controller(port)
                self.assertTrue(controller.recover(**CONFIRMATIONS))
                before = list(port.writes)
                if transport == 'stale':
                    clock.return_value += HEALTH_MAX_AGE_SECONDS
                else:
                    port.close()
                result = controller.command('Station 1', 'OPEN')
                expected_error = 'health is stale' if transport == 'stale' else 'connection is unavailable'
                self.assertIn(expected_error, result.error)
                self.assertIs(result.command_transmitted, False)
                self.assertEqual(port.writes, before)

    def test_manual_recovery_refuses_new_session_with_nonzero_transaction_counter(self):
        old, new = FakeSerial(), FakeSerial(session_ids=[NEW_SESSION])
        new.last_transaction_id = 1
        controller = self.controller(old, SerialFactory([new]))
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.recover(**CONFIRMATIONS))
        self.assertFalse(controller.armed)
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in old.writes + new.writes))

    def test_startup_connects_without_arming_or_movement(self):
        port = FakeSerial()
        controller = self.controller(port)
        self.assertTrue(self.connect(controller))
        self.assertEqual(controller.connection_status, 'connected')
        self.assertFalse(controller.armed)
        self.assertTrue(controller.status_snapshot()['communication_ready'])
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in port.writes))

    def test_worker_backoff_and_shutdown_are_interruptible(self):
        controller = self.controller()
        delays = []

        def wait(delay):
            delays.append(delay)
            if len(delays) == 7:
                controller._stop.set()

        with patch.object(controller, '_connect_locked', return_value=False), patch.object(controller._stop, 'wait', side_effect=wait):
            controller._connection_loop()
        self.assertEqual(delays, [1, 2, 4, 8, 15, 15, 15])

    def test_start_is_idempotent_and_close_joins_worker(self):
        port = FakeSerial()
        controller = self.controller(port)
        connected = threading.Event()
        original = controller._connect_locked

        def connect():
            result = original()
            connected.set()
            return result

        with patch.object(controller, '_connect_locked', side_effect=connect):
            controller.start()
            worker = controller._worker
            controller.start()
            self.assertIs(worker, controller._worker)
            self.assertTrue(connected.wait(1))
            controller.close()
        self.assertFalse(worker.is_alive())
        self.assertTrue(port.closed)
        self.assertEqual(controller.connection_status, 'closed')
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in port.writes))

    def test_idle_disconnect_requires_recovery_even_when_session_and_inputs_match(self):
        old, new = FakeSerial(), FakeSerial()
        controller = self.controller(old, SerialFactory([new]))
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.COMPLETED)
        new.last_transaction_id = old.last_transaction_id
        old.handshake_override = b''
        self.assertFalse(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertTrue(controller.status_snapshot()['communication_ready'])
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in new.writes))
        self.assertFalse(controller.command('Station 2', 'OPEN').command_transmitted)

    def test_missing_device_retries_then_connects_disarmed(self):
        port = FakeSerial()
        attempts = deque([FileNotFoundError('missing'), PermissionError('denied'), port])

        def factory(**_kwargs):
            result = attempts.popleft()
            if isinstance(result, Exception):
                raise result
            return result

        controller = self.controller(factory=factory)
        self.assertFalse(self.connect(controller))
        self.assertFalse(self.connect(controller))
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)

    def test_changed_input_during_idle_disconnect_requires_recovery(self):
        old, new = FakeSerial(), FakeSerial()
        new.open_inputs[0] = True
        controller = self.controller(old, SerialFactory([new]))
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        controller._disconnect()
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertTrue(controller.status_snapshot()['open_inputs']['Station 1'])

    def test_changed_session_or_history_requires_manual_recovery(self):
        for session, last in ((NEW_SESSION, 0), (SESSION, 2)):
            with self.subTest(session=session, last=last):
                old, new = FakeSerial(), FakeSerial(session_ids=[session])
                new.last_transaction_id = last
                controller = self.controller(old, SerialFactory([new]))
                self.assertTrue(controller.recover(**CONFIRMATIONS))
                controller._disconnect()
                self.assertTrue(self.connect(controller))
                self.assertFalse(controller.armed)
                self.assertEqual(controller._fault_session_id, SESSION)
                self.assertFalse(any(frame.startswith(b'CMD,') for frame in new.writes))

    def test_interrupted_command_reconnect_does_not_rearm_or_replay(self):
        old = FakeSerial(command_responses=(response(SESSION, 1, 'ACCEPTED', '1'),))
        new = FakeSerial()
        new.last_transaction_id = 1
        controller = self.controller(old, SerialFactory([new]))
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.UNCERTAIN)
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in new.writes))

    def test_recovery_uses_fault_session_even_if_worker_observes_power_cycle(self):
        old = FakeSerial(command_responses=())
        new, recovery = FakeSerial(session_ids=[NEW_SESSION]), FakeSerial(session_ids=[NEW_SESSION])
        controller = self.controller(old, SerialFactory([new, recovery]))
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        controller.command('Station 1', 'OPEN')
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        self.assertTrue(controller.armed)
        self.assertFalse(any(frame.startswith(b'CMD,') for frame in new.writes + recovery.writes))

    def test_idle_stop_latch_survives_input_release_and_reconnect(self):
        old, new = FakeSerial(), FakeSerial()
        controller = self.controller(old, SerialFactory([new, FakeSerial()]))
        self.assertTrue(controller.recover(**CONFIRMATIONS))
        old.stop_latched = True
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertTrue(controller.status_snapshot()['stop_latched'])
        controller._disconnect()
        self.assertTrue(self.connect(controller))
        self.assertFalse(controller.armed)
        self.assertFalse(controller.recover(**CONFIRMATIONS))

    def test_open_input_blocks_only_its_station_without_command(self):
        for i, station in enumerate(('Station 1', 'Station 2')):
            with self.subTest(station=station):
                port = FakeSerial()
                controller = self.controller(port)
                self.assertTrue(controller.recover(**CONFIRMATIONS))
                port.open_inputs[i] = True
                result = controller.command(station, 'OPEN')
                self.assertEqual(result.outcome, MotorOutcome.REJECTED)
                self.assertFalse(result.command_transmitted)
                self.assertIn('active or disconnected', result.error)
                self.assertEqual(controller.command(f'Station {2 - i}', 'OPEN').outcome, MotorOutcome.COMPLETED)

    def test_close_never_touches_serial(self):
        port = FakeSerial()
        controller = self.controller(port)
        for station in ('Station 1', 'Station 2'):
            result = controller.command(station, 'CLOSE')
            self.assertEqual(result.outcome, MotorOutcome.REJECTED)
            self.assertFalse(result.command_transmitted)
        self.assertEqual(port.writes, [])

    def test_safety_abort_is_terminal_uncertain_and_latched(self):
        for station, command in (('Station 1', '1'), ('Station 2', '3')):
            for reason in ('LIMIT_INPUT_OPEN', 'STOP_LATCHED'):
                with self.subTest(station=station, reason=reason):
                    port = FakeSerial(command_responses=(
                        response(SESSION, 1, 'ACCEPTED', command),
                        response(SESSION, 1, 'BUSY', command),
                        response(SESSION, 1, 'ABORTED', command, reason),
                    ))
                    controller = self.controller(port)
                    self.assertTrue(controller.recover(**CONFIRMATIONS))
                    result = controller.command(station, 'OPEN')
                    self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
                    self.assertTrue(result.command_transmitted)
                    self.assertIn(reason, result.error)
                    self.assertFalse(controller.armed)
                    self.assertEqual(controller.status_snapshot()['stop_latched'], reason == 'STOP_LATCHED')
                    self.assertTrue(self.connect(controller))
                    self.assertFalse(controller.armed)

    def test_safety_rejections_are_understood(self):
        for station, command in (('Station 1', '1'), ('Station 2', '3')):
            for reason in ('BENCH_OPEN_ONLY', 'TARGET_LIMIT_ACTIVE', 'STOP_LATCHED'):
                with self.subTest(station=station, reason=reason):
                    port = FakeSerial(command_responses=(response(SESSION, 1, 'REJECTED', command, reason),))
                    controller = self.controller(port)
                    self.assertTrue(controller.recover(**CONFIRMATIONS))
                    result = controller.command(station, 'OPEN')
                    self.assertEqual(result.outcome, MotorOutcome.REJECTED)
                    self.assertIn(reason, result.error)
                    self.assertEqual(controller.armed, reason != 'STOP_LATCHED')
                    self.assertEqual(controller.status_snapshot()['stop_latched'], reason == 'STOP_LATCHED')

    def test_incompatible_malformed_or_mismatched_status_prevents_arming(self):
        for status in (b'', b'ERR,2,0123456789abcdef,UNEXPECTED_FRAME\n',
                       b'STATE,2,0123456789abcdef,0000000000000000,0,IDLE,0,0,0,BENCH_OPEN_ONLY\n'):
            port = FakeSerial()
            port.status_override = status
            controller = self.controller(port)
            self.assertFalse(controller.recover(**CONFIRMATIONS))
            self.assertFalse(controller.armed)
            self.assertFalse(any(frame.startswith(b'CMD,') for frame in port.writes))

    def test_ready_high_water_overflow_is_rejected(self):
        port = FakeSerial()
        port.last_transaction_id = MAX_TRANSACTION_ID + 1
        controller = self.controller(port)
        self.assertFalse(self.connect(controller))
        self.assertFalse(controller.armed)

    def test_status_frame_fits_protocol_limit(self):
        frame = f'STATE,2,{SESSION},{NEW_SESSION},{MAX_TRANSACTION_ID},DRAINING,1,1,1,BENCH_OPEN_ONLY\n'
        self.assertLessEqual(len(frame), MAX_FRAME_BYTES)


if __name__ == '__main__':
    unittest.main()
