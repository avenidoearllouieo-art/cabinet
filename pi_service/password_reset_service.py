"""Local Raspberry Pi bridge for TapTrack password-reset NFC verification."""

from __future__ import annotations

import json
import os
import queue
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class NFCScanner(Protocol):
    def scan_uid(self) -> str:
        """Block until a card is scanned and return its UID."""


class MockNFCScanner:
    """Explicit development adapter; never enabled implicitly in production."""

    def __init__(self, uid: str):
        self.uid = uid
        self._scan_requests = queue.Queue()

    def scan_uid(self) -> str:
        try:
            return self._scan_requests.get(timeout=120)
        except queue.Empty as error:
            raise TimeoutError('Mock NFC scan timed out.') from error

    def simulate_scan(self, uid: str | None = None) -> None:
        self._scan_requests.put(uid or self.uid)


class ProductionNFCScanner:
    """Hardware boundary for the eventual Raspberry Pi reader integration."""

    def scan_uid(self) -> str:
        raise NotImplementedError('Connect the production NFC reader adapter here.')


@dataclass(frozen=True)
class Handoff:
    request_id: str
    student_id: str
    expires_at: str


class DjangoClient:
    def __init__(self, api_base_url: str, api_key: str, opener: Callable = urlopen):
        self.api_base_url = api_base_url.rstrip('/')
        self.api_key = api_key
        self.opener = opener

    def _post(self, path: str, payload: dict) -> dict:
        request = Request(
            f'{self.api_base_url}{path}',
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-API-Key': self.api_key,
            },
            method='POST',
        )
        try:
            with self.opener(request, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
        except HTTPError as error:
            try:
                error_payload = json.loads(error.read().decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                error_payload = {}
            raise DjangoAPIError(error.code, error_payload) from error

    def claim_handoff(self, request_id: str) -> Handoff:
        data = self._post('/auth/password-reset/cabinet-handoff/', {'request_id': request_id})
        return Handoff(
            request_id=data['request_id'],
            student_id=data['student_id'],
            expires_at=data['expires_at'],
        )

    def verify_nfc(self, handoff: Handoff, nfc_uid: str) -> str:
        data = self._post('/auth/password-reset/verify-nfc/', {
            'request_id': handoff.request_id,
            'student_id': handoff.student_id,
            'nfc_uid': nfc_uid,
        })
        return data['reset_token']

    def verify_access(self, nfc_uid: str) -> dict:
        return self._post('/verify-nfc/', {'nfc_uid': nfc_uid})

    def register_student(self, full_name: str, student_id: str, email: str, section: str, nfc_uid: str) -> dict:
        return self._post('/cabinet/register/', {
            'full_name': full_name,
            'student_id': student_id,
            'email': email,
            'section': section,
            'nfc_uid': nfc_uid,
        })


class DjangoAPIError(RuntimeError):
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self.payload = payload or {}
        super().__init__(f'Django request failed with status {status_code}.')


class CabinetDisplay(Protocol):
    def show_message(self, title: str, message: str) -> None:
        """Display a non-sensitive status message."""

    def show_reset_code(self, reset_token: str, expires_at: str) -> None:
        """Display the one-time reset code locally on the cabinet."""


class ConsoleDisplay:
    """Development display; never logs tokens or other sensitive values."""

    def show_message(self, title: str, message: str) -> None:
        print(f'[{title}] {message}')

    def show_reset_code(self, reset_token: str, expires_at: str) -> None:
        # A real cabinet display should render the code directly on-device.
        # Do not print reset_token to logs or terminal output.
        raise RuntimeError('Configure a local cabinet display adapter before showing reset codes.')


class MockDisplay:
    """In-memory cabinet display used by the React prototype and tests."""

    def __init__(self):
        self._state = {
            'state': 'idle',
            'title': 'Cabinet Access',
            'message': 'Ready for the next cabinet session.',
            'reset_token': None,
            'expires_at': None,
        }
        self._lock = threading.Lock()

    def show_message(self, title: str, message: str) -> None:
        with self._lock:
            state = 'waiting' if title == 'PASSWORD RECOVERY' else 'error' if 'failed' in title.lower() or 'unavailable' in title.lower() else 'idle'
            self._state = {
                'state': state,
                'title': title,
                'message': message,
                'reset_token': None,
                'expires_at': None,
            }

    def show_reset_code(self, reset_token: str, expires_at: str) -> None:
        with self._lock:
            self._state = {
                'state': 'code',
                'title': 'PASSWORD RESET CODE',
                'message': 'Enter this code on the Password Recovery page. Code expires soon.',
                'reset_token': reset_token,
                'expires_at': expires_at,
            }

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._state)

    def clear(self) -> None:
        self.show_message('Cabinet Access', 'Ready for the next cabinet session.')


class PasswordResetController:
    def __init__(self, django: DjangoClient, scanner: NFCScanner, display: CabinetDisplay):
        self.django = django
        self.scanner = scanner
        self.display = display
        self._active_handoff: Handoff | None = None
        self._captured_mock_uid: str | None = None
        self._lock = threading.Lock()

    def accept_handoff(self, request_id: str) -> Handoff:
        if not request_id or len(request_id) > 64:
            raise ValueError('Invalid reset request.')
        with self._lock:
            if self._active_handoff is not None:
                raise RuntimeError('A password-reset handoff is already active.')
            handoff = self.django.claim_handoff(request_id)
            self._active_handoff = handoff
        self.display.show_message('PASSWORD RECOVERY', 'Request received. Tap the registered NFC card.')
        return handoff

    def verify_active_card(self) -> None:
        with self._lock:
            handoff = self._active_handoff
        if handoff is None:
            raise RuntimeError('No password-reset handoff is active.')

        try:
            nfc_uid = self.scanner.scan_uid()
            reset_token = self.django.verify_nfc(handoff, nfc_uid)
            self.display.show_reset_code(reset_token, handoff.expires_at)
            with self._lock:
                self._active_handoff = None
        except DjangoAPIError as error:
            message = {
                404: 'This password-reset request is invalid.',
                409: 'This password-reset request is no longer available.',
                410: 'This password-reset request has expired.',
            }.get(error.status_code, 'Verification failed. Please try again.')
            self.display.show_message('NFC verification failed', message)
        except URLError:
            self.display.show_message('Backend unavailable', 'Please try again when the cabinet connection is restored.')
        except TimeoutError:
            self.display.show_message('NFC read failure', 'No card was detected. Please try again.')
        except (KeyError, ValueError):
            self.display.show_message('NFC verification failed', 'Please use your registered NFC card.')
        except RuntimeError:
            self.display.show_message('Hardware unavailable', 'The cabinet reader is unavailable. Please contact support.')

    def simulate_mock_scan(self, uid: str | None = None) -> None:
        if not isinstance(self.scanner, MockNFCScanner):
            raise RuntimeError('Mock scanning is disabled in production mode.')
        self.scanner.simulate_scan(uid)

    def capture_mock_uid(self, uid: str | None = None) -> None:
        if not isinstance(self.scanner, MockNFCScanner):
            raise RuntimeError('Mock scanning is disabled in production mode.')
        self.scanner.simulate_scan(uid)
        with self._lock:
            self._captured_mock_uid = self.scanner.scan_uid()

    def register_mock_student(self, full_name: str, student_id: str, email: str, section: str) -> dict:
        with self._lock:
            nfc_uid = self._captured_mock_uid
            self._captured_mock_uid = None
        if not nfc_uid:
            raise ValueError('A mock card must be captured before registration.')
        return self.django.register_student(full_name, student_id, email, section, nfc_uid)

    def verify_mock_access(self, uid: str | None = None) -> dict:
        if not isinstance(self.scanner, MockNFCScanner):
            raise RuntimeError('Mock scanning is disabled in production mode.')
        self.scanner.simulate_scan(uid)
        nfc_uid = self.scanner.scan_uid()
        return self.django.verify_access(nfc_uid)

    def scan_access_card(self) -> str:
        return self.scanner.scan_uid()

    def verify_access_card(self, nfc_uid: str) -> dict:
        if not nfc_uid:
            raise ValueError('NFC UID is required.')
        return self.django.verify_access(nfc_uid)

    def display_snapshot(self) -> dict:
        if not isinstance(self.display, MockDisplay):
            raise RuntimeError('Mock display state is unavailable in production mode.')
        return self.display.snapshot()

    def clear_display(self) -> None:
        if isinstance(self.display, MockDisplay):
            self.display.clear()


class HandoffHandler(BaseHTTPRequestHandler):
    controller: PasswordResetController | None = None

    def _allowed_origins(self) -> set[str]:
        configured = os.environ.get('TAPTRACK_WEB_ORIGINS')
        if configured:
            return {origin.strip() for origin in configured.split(',') if origin.strip()}
        single_origin = os.environ.get('TAPTRACK_WEB_ORIGIN')
        if single_origin:
            return {single_origin.strip()}
        return {
            'http://127.0.0.1:5176',
            'http://localhost:5176',
            'http://127.0.0.1:5173',
            'http://localhost:5173',
        }

    def _request_origin_is_allowed(self) -> bool:
        origin = self.headers.get('Origin')
        return origin is None or origin in self._allowed_origins()

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        origin = self.headers.get('Origin')
        if origin in self._allowed_origins():
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send_json(HTTPStatus.NO_CONTENT, {})

    def do_POST(self) -> None:
        if self.controller is None or self.path not in (
            '/password-reset/handoff',
            '/password-reset/retry',
            '/password-reset/mock-scan',
            '/password-reset/clear',
            '/cabinet/mock-capture',
            '/cabinet/register',
            '/cabinet/mock-access',
            '/cabinet/verify',
        ):
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return

        if not self._request_origin_is_allowed():
            self._send_json(HTTPStatus.FORBIDDEN, {'error': 'Origin is not allowed.'})
            return

        try:
            if self.path == '/password-reset/display':
                self._send_json(HTTPStatus.OK, self.controller.display_snapshot())
                return

            if self.path == '/password-reset/clear':
                self.controller.clear_display()
                self._send_json(HTTPStatus.OK, {'cleared': True})
                return

            if self.path == '/password-reset/mock-scan':
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                self.controller.simulate_mock_scan(str(payload.get('uid', '')).strip() or None)
                self._send_json(HTTPStatus.OK, {'accepted': True})
                return

            if self.path == '/cabinet/mock-capture':
                self.controller.capture_mock_uid()
                self._send_json(HTTPStatus.OK, {'captured': True})
                return

            if self.path in ('/cabinet/register', '/cabinet/mock-access'):
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                if self.path == '/cabinet/mock-access':
                    result = self.controller.verify_mock_access(str(payload.get('uid', '')).strip() or None)
                else:
                    result = self.controller.register_mock_student(
                        str(payload.get('full_name', '')).strip(),
                        str(payload.get('student_id', '')).strip(),
                        str(payload.get('email', '')).strip(),
                        str(payload.get('section', '')).strip(),
                    )
                self._send_json(HTTPStatus.OK, result)
                return

            if self.path == '/cabinet/verify':
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                try:
                    result = self.controller.verify_access_card(str(payload.get('nfc_uid', '')).strip())
                    self._send_json(HTTPStatus.OK, result)
                except DjangoAPIError as error:
                    fallback = 'NFC card not registered.' if error.status_code == 404 else 'Django verification failed.'
                    response = error.payload or {'success': False, 'error': fallback}
                    self._send_json(HTTPStatus(error.status_code), response)
                return

            if self.path == '/password-reset/retry':
                with self.controller._lock:
                    if self.controller._active_handoff is None:
                        raise RuntimeError('No password-reset handoff is active.')
                    handoff = self.controller._active_handoff
                self._send_json(HTTPStatus.OK, {'accepted': True, 'expires_at': handoff.expires_at})
                threading.Thread(target=self.controller.verify_active_card, daemon=True).start()
                return

            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            handoff = self.controller.accept_handoff(str(payload.get('request_id', '')).strip())
            self._send_json(HTTPStatus.OK, {'accepted': True, 'expires_at': handoff.expires_at})
            threading.Thread(target=self.controller.verify_active_card, daemon=True).start()
        except DjangoAPIError:
            self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Django rejected the handoff.'})
        except (URLError, ValueError, RuntimeError, KeyError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Password-reset handoff could not be accepted.'})

    def do_GET(self) -> None:
        if self.controller is None or self.path not in ('/password-reset/display', '/status', '/cabinet/scan'):
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return

        if not self._request_origin_is_allowed():
            self._send_json(HTTPStatus.FORBIDDEN, {'error': 'Origin is not allowed.'})
            return

        try:
            if self.path == '/status':
                self._send_json(HTTPStatus.OK, {
                    'mode': 'mock',
                    'django_api': 'configured',
                    'physical_hardware': 'not connected',
                    'cabinet_actions': 'mock only',
                })
                return
            if self.path == '/cabinet/scan':
                nfc_uid = self.controller.scan_access_card()
                self._send_json(HTTPStatus.OK, {'success': True, 'nfc_uid': nfc_uid})
                return
            self._send_json(HTTPStatus.OK, self.controller.display_snapshot())
        except RuntimeError:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {'error': 'Display state is unavailable.'})

    def log_message(self, format: str, *args) -> None:
        # Request paths may contain sensitive data in future integrations.
        return


def build_controller() -> PasswordResetController:
    api_base_url = os.environ.get('TAPTRACK_API_BASE_URL', 'http://127.0.0.1:8000/api')
    api_key = os.environ.get('DEVICE_API_KEY', '').strip()
    if not api_key:
        raise RuntimeError('DEVICE_API_KEY must be configured on the Raspberry Pi.')

    if os.environ.get('TAPTRACK_NFC_MODE', '').lower() == 'mock':
        mock_uid = os.environ.get('TAPTRACK_MOCK_NFC_UID', '').strip()
        if not mock_uid:
            raise RuntimeError('TAPTRACK_MOCK_NFC_UID is required in mock mode.')
        scanner: NFCScanner = MockNFCScanner(mock_uid)
    else:
        scanner = ProductionNFCScanner()

    display = MockDisplay() if os.environ.get('TAPTRACK_NFC_MODE', '').lower() == 'mock' else ConsoleDisplay()
    return PasswordResetController(DjangoClient(api_base_url, api_key), scanner, display)


def main() -> None:
    controller = build_controller()
    HandoffHandler.controller = controller
    host = os.environ.get('TAPTRACK_PI_BIND_HOST', '127.0.0.1')
    port = int(os.environ.get('TAPTRACK_PI_PORT', '8765'))
    server = ThreadingHTTPServer((host, port), HandoffHandler)
    print(f'TapTrack password-reset service listening on {host}:{port}')
    server.serve_forever()


if __name__ == '__main__':
    main()
