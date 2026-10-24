import threading
import unittest
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from motor_controller import (
    MAX_FRAME_BYTES,
    MotorOutcome,
    SerialMotorController,
)


SESSION = '0123456789abcdef'
NEW_SESSION = 'fedcba9876543210'


def response(session, transaction, status, command, reason=None):
    fields = ['RSP', '2', session, str(transaction), status, command]
    if reason is not None:
        fields.append(reason)
    return (','.join(fields) + '\n').encode('ascii')


class FakeSerial:
    def __init__(
        self,
        *,
        session_ids=None,
        command_responses=None,
        handshake_override=None,
        write_error=None,
        block_command_read=False,
    ):
        self.session_ids = deque(session_ids or [SESSION])
        self.last_transaction_id = 0
        self.motor_state = 'IDLE'
        self.command_responses = command_responses
        self.handshake_override = handshake_override
        self.write_error = write_error
        self.block_command_read = block_command_read
        self.command_started = False
        self.blocked_once = False
        self.read_started = threading.Event()
        self.release_read = threading.Event()

        self.responses = deque()
        self.writes = []
        self.timeout = None
        self.port = None
        self.dtr = None
        self.rts = None
        self.opened = False
        self.closed = False

    @property
    def in_waiting(self):
        return sum(len(item) for item in self.responses if isinstance(item, bytes))

    def open(self):
        self.opened = True

    def write(self, payload):
        self.writes.append(payload)
        if self.write_error:
            raise self.write_error
        if payload.startswith(b'HELLO,2,'):
            nonce = payload[:-1].decode('ascii').split(',')[2]
            if self.handshake_override is not None:
                self.responses.append(self.handshake_override)
            else:
                session_id = self.session_ids[0] if len(self.session_ids) == 1 else self.session_ids.popleft()
                self.responses.append(
                    f'READY,2,{session_id},{nonce},{self.last_transaction_id},{self.motor_state}\n'.encode('ascii')
                )
        elif payload.startswith(b'CMD,2,'):
            self.command_started = True
            fields = payload[:-1].decode('ascii').split(',')
            _, _, session_id, transaction_id, command = fields
            self.last_transaction_id = max(self.last_transaction_id, int(transaction_id))
            if self.command_responses is None:
                statuses = ('ACCEPTED', 'BUSY', 'DONE')
                for status in statuses:
                    self.responses.append(response(session_id, transaction_id, status, command))
            else:
                for item in self.command_responses:
                    self.responses.append(item)
        return len(payload)

    def flush(self):
        pass

    def read_until(self, expected=b'\n', size=None):
        self.read_started.set()
        if self.block_command_read and self.command_started and not self.blocked_once:
            self.blocked_once = True
            self.release_read.wait(timeout=2)
        if not self.responses:
            return b''
        item = self.responses.popleft()
        if isinstance(item, Exception):
            raise item
        if size is not None and len(item) > size:
            self.responses.appendleft(item[size:])
            return item[:size]
        return item

    def close(self):
        self.closed = True


class SerialFactory:
    def __init__(self, serial_ports):
        self.serial_ports = deque(serial_ports)
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.serial_ports.popleft()


class SerialMotorControllerTests(unittest.TestCase):
    def arm_for_bench_test(self, controller):
        self.assertTrue(controller.recover(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))

    def test_mapping_and_correlated_v2_response_sequence(self):
        cases = (
            ('Station 1', 'OPEN', '1'),
            ('Station 1', 'CLOSE', '2'),
            ('Station 2', 'OPEN', '3'),
            ('Station 2', 'CLOSE', '4'),
        )
        for station, action, command in cases:
            with self.subTest(station=station, action=action):
                serial_port = FakeSerial()
                controller = SerialMotorController(serial_instance=serial_port)
                self.arm_for_bench_test(controller)

                result = controller.command(station, action)

                self.assertEqual(result.outcome, MotorOutcome.COMPLETED)
                self.assertTrue(result.accepted)
                self.assertTrue(result.busy)
                self.assertEqual(result.session_id, SESSION)
                self.assertEqual(result.transaction_id, 1)
                self.assertEqual(serial_port.writes[0].split(b',')[0], b'HELLO')
                self.assertEqual(serial_port.writes[1], f'CMD,2,{SESSION},1,{command}\n'.encode())
                self.assertEqual([line.split(',')[4] for line in result.responses], ['ACCEPTED', 'BUSY', 'DONE'])

    def test_invalid_station_or_action_is_rejected_before_serial_access(self):
        serial_port = FakeSerial()
        controller = SerialMotorController(serial_instance=serial_port)
        for station, action in (('Station 3', 'OPEN'), ('Station 1', 'TOGGLE'), (' station 1', 'CLOSE')):
            with self.subTest(station=station, action=action):
                with self.assertRaises(ValueError):
                    controller.command(station, action)
        self.assertEqual(serial_port.writes, [])

    def test_new_process_starts_disarmed_and_sends_no_command(self):
        serial_port = FakeSerial()
        controller = SerialMotorController(serial_instance=serial_port)

        result = controller.command('Station 1', 'OPEN')

        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(serial_port.writes, [])

    def test_ready_timeout_sends_no_command_and_latches_uncertainty(self):
        serial_port = FakeSerial(handshake_override=b'')
        controller = SerialMotorController(serial_instance=serial_port, response_timeout=0.01)

        result = controller.command('Station 1', 'OPEN')

        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertTrue(all(write.startswith(b'HELLO,') for write in serial_port.writes))
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 0)

    def test_environment_configuration_and_inactive_dtr_rts_before_open(self):
        serial_port = FakeSerial()
        factory = SerialFactory([serial_port])
        with patch.dict('os.environ', {
            'TAPTRACK_MOTOR_SERIAL_DEVICE': '/dev/ttyUSB1',
            'TAPTRACK_MOTOR_BAUD_RATE': '57600',
            'TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS': '3.5',
        }):
            controller = SerialMotorController(serial_factory=factory)
            self.arm_for_bench_test(controller)
            controller.command('Station 1', 'OPEN')
        self.assertEqual(factory.calls[0], {'port': None, 'baudrate': 57600, 'timeout': 3.5})
        self.assertEqual(serial_port.port, '/dev/ttyUSB1')
        self.assertFalse(serial_port.dtr)
        self.assertFalse(serial_port.rts)
        self.assertTrue(serial_port.opened)

    def test_close_closes_the_shared_serial_port_and_prevents_future_commands(self):
        serial_port = FakeSerial()
        controller = SerialMotorController(serial_instance=serial_port)
        self.arm_for_bench_test(controller)

        controller.close()
        controller.close()

        self.assertTrue(serial_port.closed)
        result = controller.command('Station 1', 'OPEN')
        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertFalse(any(write.startswith(b'CMD,') for write in serial_port.writes))

    def test_invalid_frames_and_transaction_ids_are_rejected(self):
        invalid_frames = (
            b'RSP,2,,1,ACCEPTED,1\n',
            b'RSP,2,' + SESSION.encode() + b',01,ACCEPTED,1\n',
            b'RSP,2,' + SESSION.encode() + b',4294967296,ACCEPTED,1\n',
            b'RSP,2,' + SESSION.encode() + b',18446744073709551617,ACCEPTED,1\n',
            b'RSP,2,' + SESSION.encode() + b',1,ACCEPTED,1\r\n',
            b'RSP,2,' + SESSION.encode() + b',1,ACCEPTED,1,EXTRA\n',
            b'RSP,2,' + SESSION.encode() + b',1,ACCEPTED,1',
            b'RSP,2,' + SESSION.encode() + b',1,ACCEPTED,1,' + b'X' * MAX_FRAME_BYTES + b'\n',
        )
        for frame in invalid_frames:
            with self.subTest(frame=frame[:40]):
                serial_port = FakeSerial(command_responses=(frame,))
                controller = SerialMotorController(serial_instance=serial_port)
                self.arm_for_bench_test(controller)
                result = controller.command('Station 1', 'OPEN')
                self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
                self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_mismatched_session_transaction_command_and_order_latch_uncertainty(self):
        cases = (
            (response(NEW_SESSION, 1, 'ACCEPTED', '1'),),
            (response(SESSION, 2, 'ACCEPTED', '1'),),
            (response(SESSION, 1, 'ACCEPTED', '2'),),
            (response(SESSION, 1, 'BUSY', '1'),),
            (response(SESSION, 1, 'ACCEPTED', '1'), response(SESSION, 1, 'DONE', '1')),
            (response(SESSION, 1, 'ACCEPTED', '1'), response(SESSION, 1, 'ACCEPTED', '1')),
        )
        for command_responses in cases:
            with self.subTest(command_responses=command_responses):
                serial_port = FakeSerial(command_responses=command_responses)
                controller = SerialMotorController(serial_instance=serial_port)
                self.arm_for_bench_test(controller)
                result = controller.command('Station 1', 'OPEN')
                self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
                second = controller.command('Station 1', 'OPEN')
                self.assertEqual(second.outcome, MotorOutcome.UNCERTAIN)
                self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_firmware_rejection_is_terminal_and_not_retried(self):
        serial_port = FakeSerial(command_responses=(response(SESSION, 1, 'REJECTED', '1', 'BUSY'),))
        controller = SerialMotorController(serial_instance=serial_port)
        self.arm_for_bench_test(controller)
        result = controller.command('Station 1', 'OPEN')
        self.assertEqual(result.outcome, MotorOutcome.REJECTED)
        self.assertFalse(result.accepted)
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_unexpected_rejection_latches_without_retry(self):
        serial_port = FakeSerial(command_responses=(response(SESSION, 1, 'REJECTED', '1', 'BAD_COMMAND'),))
        controller = SerialMotorController(serial_instance=serial_port)
        self.arm_for_bench_test(controller)

        result = controller.command('Station 1', 'OPEN')

        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_timeout_at_each_response_phase_latches_and_never_retries(self):
        for partial_sequence in ((), (response(SESSION, 1, 'ACCEPTED', '1'),), (
            response(SESSION, 1, 'ACCEPTED', '1'), response(SESSION, 1, 'BUSY', '1'),
        )):
            with self.subTest(partial_sequence=partial_sequence):
                serial_port = FakeSerial(command_responses=partial_sequence)
                controller = SerialMotorController(serial_instance=serial_port, response_timeout=0.01)
                self.arm_for_bench_test(controller)
                result = controller.command('Station 1', 'OPEN')
                self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
                controller.command('Station 1', 'OPEN')
                self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_disconnect_at_write_and_response_phases_latches(self):
        for command_responses in (
            (OSError('disconnect after command'),),
            (response(SESSION, 1, 'ACCEPTED', '1'), OSError('disconnect after accepted')),
            (response(SESSION, 1, 'ACCEPTED', '1'), response(SESSION, 1, 'BUSY', '1'), OSError('disconnect after busy')),
        ):
            with self.subTest(command_responses=command_responses):
                serial_port = FakeSerial(command_responses=command_responses)
                controller = SerialMotorController(serial_instance=serial_port)
                self.arm_for_bench_test(controller)
                result = controller.command('Station 1', 'OPEN')
                self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
                self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_ready_or_reset_frame_during_transaction_is_uncertain(self):
        serial_port = FakeSerial(command_responses=(b'READY,2,' + NEW_SESSION.encode() + b',0123456789abcdef\n',))
        controller = SerialMotorController(serial_instance=serial_port)
        self.arm_for_bench_test(controller)
        result = controller.command('Station 1', 'OPEN')
        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_mismatched_handshake_fails_closed_without_movement(self):
        serial_port = FakeSerial(handshake_override=b'READY,2,' + SESSION.encode() + b',0000000000000000\n')
        controller = SerialMotorController(serial_instance=serial_port, response_timeout=0.01)
        self.assertFalse(controller.recover(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))
        self.assertTrue(all(write.startswith(b'HELLO,') for write in serial_port.writes))
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 0)
        self.assertEqual(len(serial_port.writes), 1)

    def test_pending_unsolicited_frame_blocks_next_movement_write(self):
        serial_port = FakeSerial()
        controller = SerialMotorController(serial_instance=serial_port)
        self.arm_for_bench_test(controller)
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.COMPLETED)
        serial_port.responses.append(response(SESSION, 1, 'DONE', '1'))

        second_result = controller.command('Station 1', 'OPEN')

        self.assertEqual(second_result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_concurrent_call_is_rejected_without_second_command(self):
        serial_port = FakeSerial(block_command_read=True)
        controller = SerialMotorController(serial_instance=serial_port, response_timeout=2)
        self.arm_for_bench_test(controller)
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(controller.command, 'Station 1', 'OPEN')
            self.assertTrue(serial_port.read_started.wait(timeout=1))
            overlap = controller.command('Station 2', 'OPEN')
            serial_port.release_read.set()
            first_result = first.result(timeout=2)
        self.assertEqual(overlap.outcome, MotorOutcome.BUSY)
        self.assertEqual(first_result.outcome, MotorOutcome.COMPLETED)
        self.assertEqual(sum(write.startswith(b'CMD,') for write in serial_port.writes), 1)

    def test_recovery_requires_both_operator_confirmations_and_sends_no_command(self):
        old_port = FakeSerial(command_responses=(response(SESSION, 1, 'ACCEPTED', '1'),))
        new_port = FakeSerial(session_ids=[NEW_SESSION])
        factory = SerialFactory([old_port, new_port])
        controller = SerialMotorController(serial_factory=factory, response_timeout=0.01)
        self.arm_for_bench_test(controller)
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.UNCERTAIN)
        self.assertFalse(controller.recover(operator_confirmed_stationary=True, operator_confirmed_esp32_power_cycled=True))
        self.assertFalse(controller.recover(operator_confirmed_driver_power_isolated=True, operator_confirmed_esp32_power_cycled=True))
        self.assertTrue(controller.recover(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))
        self.assertFalse(any(write.startswith(b'CMD,') for write in new_port.writes))
        self.assertTrue(all(write.startswith(b'HELLO,') for write in new_port.writes))

    def test_recovery_refuses_same_session_and_keeps_latch(self):
        old_port = FakeSerial(command_responses=(response(SESSION, 1, 'ACCEPTED', '1'),))
        same_session_port = FakeSerial()
        controller = SerialMotorController(
            serial_factory=SerialFactory([old_port, same_session_port]),
            response_timeout=0.01,
        )
        self.arm_for_bench_test(controller)
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.UNCERTAIN)
        self.assertFalse(controller.recover(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))
        self.assertEqual(controller.command('Station 1', 'OPEN').outcome, MotorOutcome.UNCERTAIN)
        self.assertFalse(any(write.startswith(b'CMD,') for write in same_session_port.writes))


if __name__ == '__main__':
    unittest.main()