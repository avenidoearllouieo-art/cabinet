"""Local operator recovery channel for the disarmed serial motor controller."""

from __future__ import annotations

import json
import logging
import os
import socket
import socketserver
import sys
from pathlib import Path


DEFAULT_SOCKET_PATH = '/run/taptrack/motor-control.sock'
MAX_REQUEST_BYTES = 1024
logger = logging.getLogger(__name__)
REQUIRED_CONFIRMATIONS = frozenset({
    'operator_confirmed_driver_power_isolated',
    'operator_confirmed_stationary',
    'operator_confirmed_esp32_power_cycled',
})


def is_confirmed_recovery_request(payload: object) -> bool:
    return (
        isinstance(payload, dict)
        and set(payload) == REQUIRED_CONFIRMATIONS
        and all(value is True for value in payload.values())
    )


class _RecoveryRequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw_request = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if not raw_request.endswith(b'\n') or len(raw_request) > MAX_REQUEST_BYTES:
            self._respond({'recovered': False, 'error': 'Invalid recovery request.'})
            logger.warning('motor_recovery_refused reason=invalid_request_size')
            return
        try:
            payload = json.loads(raw_request.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond({'recovered': False, 'error': 'Invalid recovery request.'})
            logger.warning('motor_recovery_refused reason=invalid_request_json')
            return

        if not is_confirmed_recovery_request(payload):
            self._respond({'recovered': False, 'error': 'All operator confirmations are required.'})
            logger.warning('motor_recovery_refused reason=operator_confirmations_incomplete')
            return

        recovered = self.server.service.recover_motor_controller(**payload)
        self._respond({
            'recovered': recovered,
            'error': None if recovered else 'Recovery failed or was refused; inspect NFC service logs.',
        })

    def _respond(self, payload: dict) -> None:
        self.wfile.write(json.dumps(payload).encode('utf-8') + b'\n')


if hasattr(socket, 'AF_UNIX'):
    class MotorRecoveryServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True
        allow_reuse_address = False

        def __init__(self, service, socket_path: str = DEFAULT_SOCKET_PATH):
            self.service = service
            self.socket_path = Path(socket_path)
            self.socket_path.parent.mkdir(parents=True, exist_ok=True)
            if self.socket_path.exists():
                if not self.socket_path.is_socket():
                    raise RuntimeError(f'Motor recovery socket path is not a socket: {self.socket_path}')
                self.socket_path.unlink()
            super().__init__(str(self.socket_path), _RecoveryRequestHandler)
            os.chmod(self.socket_path, 0o600)

        def server_close(self) -> None:
            try:
                super().server_close()
            finally:
                if self.socket_path.exists() and self.socket_path.is_socket():
                    self.socket_path.unlink()
else:
    class MotorRecoveryServer:
        def __init__(self, service, socket_path: str = DEFAULT_SOCKET_PATH):
            raise RuntimeError('Motor operator recovery requires Unix-domain socket support.')


def request_operator_recovery(socket_path: str = DEFAULT_SOCKET_PATH) -> bool:
    questions = (
        (
            'operator_confirmed_driver_power_isolated',
            'Confirm TB6600/motor-driver power is physically isolated (type YES): ',
        ),
        (
            'operator_confirmed_stationary',
            'Confirm the unloaded mechanism is stationary (type YES): ',
        ),
        (
            'operator_confirmed_esp32_power_cycled',
            'Confirm the ESP32 was power-cycled after isolation (type YES): ',
        ),
    )
    payload = {}
    for name, prompt in questions:
        if input(prompt).strip() != 'YES':
            print('Recovery cancelled; no serial command was sent.')
            return False
        payload[name] = True

    request = json.dumps(payload).encode('utf-8') + b'\n'
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(5)
        client.connect(socket_path)
        client.sendall(request)
        response = client.makefile('rb').readline(MAX_REQUEST_BYTES + 1)
    result = json.loads(response.decode('utf-8'))
    if result.get('recovered') is True:
        print('Controller recovery handshake succeeded. No motor command was sent.')
        return True

    print(result.get('error') or 'Controller recovery failed; no motor command was sent.')
    return False


if __name__ == '__main__':
    try:
        sys.exit(0 if request_operator_recovery() else 1)
    except (OSError, ValueError) as error:
        logger.error('Motor recovery request failed: %s', error)
        print(f'Motor recovery request failed: {error}', file=sys.stderr)
        sys.exit(1)
