import json
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from motor_recovery import (
    MotorRecoveryServer,
    is_confirmed_recovery_request,
    request_operator_recovery,
)


class RecoveryServiceFake:
    def __init__(self, recovered=True):
        self.recovered = recovered
        self.confirmations = []

    def recover_motor_controller(self, **confirmations):
        self.confirmations.append(confirmations)
        return self.recovered


@unittest.skipUnless(hasattr(socket, 'AF_UNIX'), 'Unix-domain sockets are unavailable on this platform.')
class MotorRecoverySocketTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.socket_path = Path(self.temp_dir.name) / 'motor-control.sock'
        self.service = RecoveryServiceFake()
        self.server = MotorRecoveryServer(self.service, str(self.socket_path))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def test_interactive_recovery_requires_all_operator_confirmations(self):
        with patch('builtins.input', side_effect=['YES', 'YES', 'YES']):
            self.assertTrue(request_operator_recovery(str(self.socket_path)))

        self.assertEqual(self.service.confirmations, [{
            'operator_confirmed_driver_power_isolated': True,
            'operator_confirmed_stationary': True,
            'operator_confirmed_esp32_power_cycled': True,
        }])

    def test_cancelled_confirmation_never_connects_to_service(self):
        with patch('builtins.input', side_effect=['YES', 'no']):
            self.assertFalse(request_operator_recovery(str(self.socket_path)))

        self.assertEqual(self.service.confirmations, [])

    def test_unconfirmed_socket_request_is_rejected(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(self.socket_path))
            client.sendall(json.dumps({
                'operator_confirmed_driver_power_isolated': True,
                'operator_confirmed_stationary': True,
                'operator_confirmed_esp32_power_cycled': False,
            }).encode('utf-8') + b'\n')
            response = client.makefile('rb').readline()

        self.assertFalse(json.loads(response)['recovered'])
        self.assertEqual(self.service.confirmations, [])

    @unittest.skipUnless(os.name == 'posix', 'Unix socket permissions are POSIX-specific.')
    def test_socket_permissions_are_owner_only(self):
        self.assertEqual(self.socket_path.stat().st_mode & 0o777, 0o600)


class RecoveryRequestValidationTests(unittest.TestCase):
    def test_requires_exact_true_confirmation_fields(self):
        accepted = {
            'operator_confirmed_driver_power_isolated': True,
            'operator_confirmed_stationary': True,
            'operator_confirmed_esp32_power_cycled': True,
        }
        self.assertTrue(is_confirmed_recovery_request(accepted))
        self.assertFalse(is_confirmed_recovery_request({**accepted, 'operator_confirmed_stationary': 1}))
        self.assertFalse(is_confirmed_recovery_request({**accepted, 'unexpected': True}))
        self.assertFalse(is_confirmed_recovery_request(['not', 'an', 'object']))


if __name__ == '__main__':
    unittest.main()
