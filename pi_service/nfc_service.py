"""Read NFC cards, verify once with Django, and expose persistent local results."""

from __future__ import annotations

import json
import logging
import math
import os
import re
import queue
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit
from uuid import uuid4

from motor_controller import (
    DEFAULT_BAUD_RATE,
    DEFAULT_RESPONSE_TIMEOUT_SECONDS,
    MotorCommandResult,
    MotorOutcome,
    SerialMotorController,
)
from motor_recovery import MotorRecoveryServer
from reader_adapters import EvdevNFCReader, ReaderUnavailable, normalize_uid


BRIDGE_HOST = '127.0.0.1'
BRIDGE_PORT = 5001
DJANGO_API_BASE_URL = os.environ.get('TAPTRACK_DJANGO_API_BASE_URL', '').strip().rstrip('/')
DJANGO_VERIFY_URL = os.environ.get('TAPTRACK_DJANGO_VERIFY_URL') or (
    f'{DJANGO_API_BASE_URL}/verify-nfc/' if DJANGO_API_BASE_URL
    else 'http://127.0.0.1:8000/api/verify-nfc/'
)
DJANGO_WORKFLOW_URL = os.environ.get('TAPTRACK_DJANGO_WORKFLOW_URL') or (
    f'{DJANGO_API_BASE_URL}/cabinet/workflow/' if DJANGO_API_BASE_URL
    else 'http://127.0.0.1:8000/api/cabinet/workflow/'
)
DATABASE_PATH = Path(os.environ.get(
    'TAPTRACK_NFC_DB_PATH',
    str(Path(__file__).resolve().with_name('nfc_events.sqlite3')),
))
DEFAULT_ALLOWED_ORIGINS = frozenset({
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5176',
    'http://localhost:5176',
})


def load_allowed_origins(configured_origins: str | None = None) -> frozenset[str]:
    if configured_origins is None:
        configured_origins = os.environ.get('TAPTRACK_NFC_ALLOWED_ORIGINS')
    if configured_origins is None:
        return DEFAULT_ALLOWED_ORIGINS

    origins = [origin.strip() for origin in configured_origins.split(',')]
    if not origins or any(not origin for origin in origins):
        raise RuntimeError('TAPTRACK_NFC_ALLOWED_ORIGINS must contain exact HTTP(S) origins.')
    for origin in origins:
        try:
            parsed = urlsplit(origin)
            parsed.port
        except ValueError as error:
            raise RuntimeError('TAPTRACK_NFC_ALLOWED_ORIGINS contains an invalid origin.') from error
        if (
            parsed.scheme not in {'http', 'https'}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or origin != f'{parsed.scheme}://{parsed.netloc}'
        ):
            raise RuntimeError('TAPTRACK_NFC_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths.')
    return frozenset(origins)


ALLOWED_ORIGINS = load_allowed_origins()
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
REQUEST_TIMEOUT_SECONDS = 5
PASSWORD_RECOVERY_MAX_REQUEST_ID_LENGTH = 128
PASSWORD_RECOVERY_DEFAULT_TTL_SECONDS = 120
PASSWORD_RECOVERY_MAX_TTL_SECONDS = 300
PHOTO_CAPTURE_URL = 'http://192.168.1.61/capture'
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MOTOR_WORKFLOW_TRANSITIONS = {
    'finish_open': 'OPEN',
    'finish_close': 'CLOSE',
}
MOTOR_STATIONS = frozenset({'Station 1', 'Station 2'})
MOTOR_ACTION_STATUSES = frozenset({'PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'UNCERTAIN'})
MOTOR_ACTION_IN_PROGRESS = ('PENDING', 'DISPATCHED')
MOTOR_ACTUATION_DISABLED = 'Motor actuation is disabled; no serial command was sent.'

logger = logging.getLogger(__name__)


class MockNFCReader:
    def __init__(self) -> None:
        self._cards: queue.Queue[str] = queue.Queue()
        self._removed = threading.Event()
        self._removed.set()

    def wait_for_card(self) -> str:
        return normalize_uid(self._cards.get())

    def wait_for_removal(self) -> None:
        self._removed.wait()
        self._removed.clear()

    def simulate_scan(self, uid: str) -> None:
        normalized = normalize_uid(uid)
        if not normalized:
            raise ValueError('NFC UID is required.')
        self._removed.clear()
        self._cards.put(normalized)

    def simulate_removal(self) -> None:
        self._removed.set()


class DjangoRequestError(RuntimeError):
    def __init__(self, message: str, http_status: int | None = None):
        super().__init__(message)
        self.http_status = http_status


class MockMotorController:
    """Mock-only command sink; it never opens or writes to a serial port."""

    def __init__(self):
        self.calls = []
        self._lock = threading.Lock()
        self.closed = False

    def command(self, station: str, action: str) -> MotorCommandResult:
        with self._lock:
            self.calls.append((station, action))
            transaction_id = len(self.calls)
        return MotorCommandResult(
            station=station,
            action=action,
            command='MOCK',
            outcome=MotorOutcome.REJECTED,
            session_id='MOCK-ONLY',
            transaction_id=transaction_id,
            error='Mock mode never actuates physical motors.',
        )

    def close(self) -> None:
        self.closed = True


def motor_result_from_action(action: dict) -> MotorCommandResult:
    outcomes = {
        'PENDING': MotorOutcome.BUSY,
        'DISPATCHED': MotorOutcome.UNCERTAIN,
        'COMPLETED': MotorOutcome.COMPLETED,
        'FAILED': MotorOutcome.REJECTED,
        'UNCERTAIN': MotorOutcome.UNCERTAIN,
    }
    operation = action['operation']
    try:
        outcome = MotorOutcome(action.get('outcome'))
    except (TypeError, ValueError):
        outcome = outcomes[action['status']]
    try:
        responses = json.loads(action.get('responses_json') or '[]')
    except (TypeError, json.JSONDecodeError):
        responses = []
    if not isinstance(responses, list) or any(not isinstance(item, str) for item in responses):
        responses = []
    command_transmitted = action.get('command_transmitted')
    if command_transmitted is not None:
        command_transmitted = bool(command_transmitted)
    elif action['status'] == 'COMPLETED':
        command_transmitted = True
    return MotorCommandResult(
        station=action['station'],
        action=operation,
        command=action.get('command') or 'MOCK',
        outcome=outcome,
        transaction_id=action.get('transaction_id'),
        command_transmitted=command_transmitted,
        responses=tuple(responses),
        error=action.get('error') or (
            'Action requires manual review.' if action['status'] == 'UNCERTAIN' else None
        ),
    )


def _motor_actuation_enabled() -> bool:
    configured = os.environ.get('TAPTRACK_MOTOR_ACTUATION_ENABLED', 'false').strip().lower()
    if configured not in {'true', 'false'}:
        raise RuntimeError('TAPTRACK_MOTOR_ACTUATION_ENABLED must be true or false.')
    return configured == 'true'


def create_motor_controller() -> MockMotorController | SerialMotorController:
    mode = os.environ.get('TAPTRACK_MOTOR_MODE', '').strip().lower()
    if mode not in {'mock', 'serial'}:
        raise RuntimeError('TAPTRACK_MOTOR_MODE must be explicitly set to mock or serial.')

    actuation_enabled = _motor_actuation_enabled()
    if mode == 'mock':
        if actuation_enabled:
            raise RuntimeError('TAPTRACK_MOTOR_ACTUATION_ENABLED cannot be true in mock mode.')
        return MockMotorController()

    if actuation_enabled:
        required_confirmations = (
            'TAPTRACK_MOTOR_LIMIT_SWITCHES_INSTALLED',
            'TAPTRACK_MOTOR_ESTOP_INSTALLED',
            'TAPTRACK_MOTOR_RECOVERY_PROCEDURE_APPROVED',
        )
        if any(os.environ.get(name, '').strip().lower() != 'true' for name in required_confirmations):
            raise RuntimeError(
                'Serial motor actuation requires confirmed limit switches, an emergency stop, '
                'and an approved recovery procedure.'
            )

    device = os.environ.get('TAPTRACK_MOTOR_SERIAL_DEVICE', '').strip()
    device_id = device.removeprefix('/dev/serial/by-id/')
    if (
        not device.startswith('/dev/serial/by-id/')
        or not device_id
        or '/' in device_id
        or '\\' in device_id
        or device_id in {'.', '..'}
    ):
        raise RuntimeError('Serial mode requires the exact stable /dev/serial/by-id/ device path.')
    if '<' in device_id or '>' in device_id:
        raise RuntimeError('Replace the serial-device placeholder with the exact stable device path.')
    try:
        baud_rate = int(os.environ.get('TAPTRACK_MOTOR_BAUD_RATE', str(DEFAULT_BAUD_RATE)))
        response_timeout = float(os.environ.get(
            'TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS',
            str(DEFAULT_RESPONSE_TIMEOUT_SECONDS),
        ))
    except ValueError as error:
        raise RuntimeError('Motor baud rate and response timeout must be numeric.') from error
    if baud_rate <= 0 or not math.isfinite(response_timeout) or response_timeout <= 0:
        raise RuntimeError('Motor baud rate and response timeout must be positive.')
    return SerialMotorController(
        device=device,
        baud_rate=baud_rate,
        response_timeout=response_timeout,
    )


def sanitize_error(value: object, api_key: str = '') -> str:
    message = ' '.join(str(value or '').split())
    if api_key:
        message = message.replace(api_key, '[redacted]')
    message = re.sub(
        r'(?i)(api[_ -]?key|password|token)(\s*[:=]\s*)[^\s,;]+',
        r'\1\2[redacted]',
        message,
    )
    return message[:300] or 'Django verification failed.'


class DjangoPhotoCapture:
    """Capture a fresh camera image and attach it to one Django access log."""

    def __init__(self, verify_url: str, api_key: str, opener=None, camera_url: str = PHOTO_CAPTURE_URL):
        parsed_url = urlsplit(verify_url)
        api_path = parsed_url.path.rstrip('/').rsplit('/', 1)[0].rstrip('/')
        self.api_base_url = urlunsplit((parsed_url.scheme, parsed_url.netloc, api_path, '', '')).rstrip('/')
        self.api_key = api_key
        self.opener = opener or urllib.request.urlopen
        self.camera_url = camera_url
        self._state_lock = threading.Lock()
        self._capture_lock = threading.Lock()
        self._inflight_events = set()

    def _request(self, request, read_limit: int = MAX_PHOTO_BYTES + 1):
        try:
            response = self.opener(request, timeout=REQUEST_TIMEOUT_SECONDS)
            with response:
                return response.status, response.read(read_limit), getattr(response, 'headers', {})
        except urllib.error.HTTPError as error:
            return error.code, error.read(read_limit), getattr(error, 'headers', {})
        except (urllib.error.URLError, TimeoutError, OSError):
            return None, b'', {}

    def _device_request(self, path: str, method: str, body: bytes | None = None, content_type: str | None = None):
        headers = {'Accept': 'application/json', 'X-API-Key': self.api_key, 'Cache-Control': 'no-cache, no-store'}
        if content_type:
            headers['Content-Type'] = content_type
        request = urllib.request.Request(
            f'{self.api_base_url}{path}', data=body, headers=headers, method=method,
        )
        status_code, response_body, _ = self._request(request)
        try:
            payload = json.loads(response_body.decode('utf-8')) if response_body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        return status_code, payload

    def _event_photo_path(self, event_id: int) -> str:
        return f'/access-logs/{event_id}/photo/'

    def _report_status(self, event_id: int, capture_status: str, error: str = '') -> None:
        path = f'/access-logs/{event_id}/photo-status/'
        payload = json.dumps({'status': capture_status, 'error': error}).encode('utf-8')
        self._device_request(path, 'POST', payload, 'application/json')

    def _capture(self, event_id: int) -> bool:
        photo_path = self._event_photo_path(event_id)
        status_code, metadata = self._device_request(photo_path, 'GET')
        if status_code != 200 or metadata.get('event_id') != event_id:
            self._report_status(event_id, 'failed', 'Unable to verify the access event photo status.')
            return False
        if metadata.get('capture_status') == 'success' and metadata.get('image_available') is True:
            return True

        pending_code, pending = self._device_request(
            f'/access-logs/{event_id}/photo-status/',
            'POST',
            json.dumps({'status': 'pending'}).encode('utf-8'),
            'application/json',
        )
        if pending_code != 200 or pending.get('event_id') != event_id:
            return False

        camera_request = urllib.request.Request(
            self.camera_url,
            headers={
                'Accept': 'image/jpeg',
                'Cache-Control': 'no-cache, no-store',
                'Pragma': 'no-cache',
            },
            method='GET',
        )
        camera_status, image_bytes, camera_headers = self._request(camera_request)
        camera_content_type = camera_headers.get('Content-Type', '') if hasattr(camera_headers, 'get') else ''
        if (
            camera_status != 200
            or len(image_bytes) > MAX_PHOTO_BYTES
            or not image_bytes.startswith(b'\xff\xd8')
            or (camera_content_type and 'image/jpeg' not in camera_content_type.lower())
        ):
            self._report_status(event_id, 'failed', 'Camera capture failed or returned an invalid JPEG image.')
            return False

        boundary = f'taptrack-{secrets.token_hex(16)}'
        multipart_body = (
            f'--{boundary}\r\n'
            'Content-Disposition: form-data; name="image"; filename="capture.jpg"\r\n'
            'Content-Type: image/jpeg\r\n\r\n'
        ).encode('ascii') + image_bytes + f'\r\n--{boundary}--\r\n'.encode('ascii')
        upload_code, upload_payload = self._device_request(
            photo_path,
            'POST',
            multipart_body,
            f'multipart/form-data; boundary={boundary}',
        )
        if upload_code == 201 and upload_payload.get('event_id') == event_id:
            return True

        if upload_code == 409:
            status_code, metadata = self._device_request(photo_path, 'GET')
            if (
                status_code == 200
                and metadata.get('event_id') == event_id
                and metadata.get('capture_status') == 'success'
                and metadata.get('image_available') is True
            ):
                return True

        self._report_status(event_id, 'failed', 'Photo upload failed.')
        return False

    def capture(self, event_id: int) -> bool:
        if isinstance(event_id, bool) or not isinstance(event_id, int) or event_id < 1:
            return False
        with self._state_lock:
            if event_id in self._inflight_events:
                return False
            self._inflight_events.add(event_id)
        try:
            with self._capture_lock:
                completed = self._capture(event_id)
        except Exception:
            try:
                self._report_status(event_id, 'failed', 'Photo capture request failed.')
            except Exception:
                pass
            completed = False
        finally:
            with self._state_lock:
                self._inflight_events.discard(event_id)
        return completed


class DjangoVerifier:
    """Make the one server-side verification request for a completed UID."""

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        opener=None,
        *,
        api_base_url: str | None = None,
        workflow_url: str | None = None,
    ):
        environment_api_base = os.environ.get('TAPTRACK_DJANGO_API_BASE_URL', '').strip().rstrip('/')
        configured_api_base = (api_base_url or environment_api_base or DJANGO_API_BASE_URL).strip().rstrip('/')
        has_explicit_api_base = bool(api_base_url or environment_api_base or DJANGO_API_BASE_URL)
        self.url = url or (f'{configured_api_base}/verify-nfc/' if has_explicit_api_base else DJANGO_VERIFY_URL)
        parsed_url = urlsplit(self.url)
        if configured_api_base:
            self.api_base_url = configured_api_base
        else:
            api_path = parsed_url.path.rstrip('/').rsplit('/', 1)[0].rstrip('/')
            self.api_base_url = urlunsplit((parsed_url.scheme, parsed_url.netloc, api_path, '', '')).rstrip('/')
        legacy_workflow_url = os.environ.get('TAPTRACK_DJANGO_WORKFLOW_URL')
        if workflow_url:
            self.workflow_url = workflow_url
        elif has_explicit_api_base:
            self.workflow_url = f'{self.api_base_url}/cabinet/workflow/'
        else:
            self.workflow_url = legacy_workflow_url or DJANGO_WORKFLOW_URL
        self.api_key = api_key if api_key is not None else (
            os.environ.get('DEVICE_API_KEY') or os.environ.get('TAPTRACK_DEVICE_API_KEY', '')
        ).strip()
        self.opener = opener
        self.photo_capture = DjangoPhotoCapture(self.url, self.api_key, opener=opener) if self.api_key else None

    def _sanitize_error(self, value: object) -> str:
        return sanitize_error(value, self.api_key)

    def _password_reset_url(self, endpoint: str) -> str:
        return f'{self.api_base_url}/auth/password-reset/{endpoint}/'

    def password_reset_request(self, endpoint: str, payload: dict) -> tuple[int, dict]:
        if not self.api_key:
            raise DjangoRequestError('Django device API key is not configured.')
        if endpoint not in {'cabinet-handoff', 'verify-nfc'}:
            raise ValueError('Unsupported password-reset endpoint.')
        request = urllib.request.Request(
            self._password_reset_url(endpoint),
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-API-Key': self.api_key,
            },
            method='POST',
        )
        try:
            opener = self.opener or urllib.request.urlopen
            response = opener(request, timeout=REQUEST_TIMEOUT_SECONDS)
            with response:
                status_code = response.status
                body = response.read()
        except urllib.error.HTTPError as error:
            status_code = error.code
            body = error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise DjangoRequestError('Unable to reach the Django password-reset service.') from error
        try:
            response_payload = json.loads(body.decode('utf-8')) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            if status_code == HTTPStatus.NOT_FOUND:
                raise DjangoRequestError(
                    'The configured Django server does not expose the password-recovery endpoint. '
                    'Check TAPTRACK_DJANGO_API_BASE_URL.',
                    status_code,
                ) from error
            raise DjangoRequestError('Django password-reset service returned malformed JSON.', status_code) from error
        if not isinstance(response_payload, dict):
            raise DjangoRequestError('Django password-reset service returned an invalid response.', status_code)
        if 'error' in response_payload:
            response_payload['error'] = self._sanitize_error(response_payload['error'])
        return status_code, response_payload

    def verify(self, uid: str) -> tuple[int, dict]:
        if not self.api_key:
            raise DjangoRequestError('Django device API key is not configured.')

        request = urllib.request.Request(
            self.url,
            data=json.dumps({'nfc_uid': uid}).encode('utf-8'),
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-API-Key': self.api_key,
            },
            method='POST',
        )

        try:
            opener = self.opener or urllib.request.urlopen
            response = opener(request, timeout=REQUEST_TIMEOUT_SECONDS)
            with response:
                status_code = response.status
                body = response.read()
        except urllib.error.HTTPError as error:
            status_code = error.code
            body = error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if isinstance(error, TimeoutError) or getattr(error, 'reason', None).__class__ is TimeoutError:
                raise DjangoRequestError('Django verification request timed out.') from error
            raise DjangoRequestError('Unable to reach the Django verification service.') from error

        try:
            payload = json.loads(body.decode('utf-8')) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}

        if not isinstance(payload, dict):
            payload = {}
        if 'error' in payload:
            payload['error'] = self._sanitize_error(payload['error'])
        return status_code, payload

    def workflow(self, command: str | None = None, station: str | None = None) -> tuple[int, dict]:
        if not self.api_key:
            raise DjangoRequestError('Django device API key is not configured.')

        workflow_payload = {'command': command} if command is not None else None
        if workflow_payload is not None and station:
            workflow_payload['station'] = station
        body = None if workflow_payload is None else json.dumps(workflow_payload).encode('utf-8')
        request = urllib.request.Request(
            self.workflow_url,
            data=body,
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-API-Key': self.api_key,
            },
            method='GET' if command is None else 'POST',
        )
        try:
            opener = self.opener or urllib.request.urlopen
            response = opener(request, timeout=REQUEST_TIMEOUT_SECONDS)
            with response:
                status_code = response.status
                response_body = response.read()
        except urllib.error.HTTPError as error:
            status_code = error.code
            response_body = error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise DjangoRequestError('Unable to reach the Django cabinet workflow.') from error

        try:
            payload = json.loads(response_body.decode('utf-8')) if response_body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if 'error' in payload:
            payload['error'] = self._sanitize_error(payload['error'])
        return status_code, payload


class SQLiteScanEventStore:
    """Persistent event log; each operation uses its own SQLite connection."""

    def __init__(self, database_path: str | Path = DATABASE_PATH):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA busy_timeout = 10000')
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._lock, self._connection() as connection:
            connection.execute('PRAGMA journal_mode = WAL')
            connection.execute('''
                CREATE TABLE IF NOT EXISTS scan_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uid TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL,
                    name TEXT,
                    student_id TEXT,
                    role TEXT,
                    registration_required INTEGER,
                    registration_url TEXT,
                    expires_at TEXT,
                    error TEXT,
                    http_status INTEGER,
                    response_json TEXT NOT NULL
                )
            ''')
            connection.execute('''
                CREATE TABLE IF NOT EXISTS motor_actions (
                    action_id TEXT PRIMARY KEY,
                    workflow_session TEXT NOT NULL,
                    station TEXT NOT NULL,
                    operation TEXT NOT NULL CHECK (operation IN ('OPEN', 'CLOSE')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'UNCERTAIN')),
                    outcome TEXT,
                    command TEXT,
                    transaction_id INTEGER,
                    responses_json TEXT,
                    UNIQUE (workflow_session, station, operation)
                )
            ''')
            columns = {
                row['name']
                for row in connection.execute('PRAGMA table_info(motor_actions)').fetchall()
            }
            if 'command_transmitted' not in columns:
                connection.execute(
                    'ALTER TABLE motor_actions ADD COLUMN command_transmitted INTEGER '
                    'CHECK (command_transmitted IN (0, 1))'
                )
            if 'error' not in columns:
                connection.execute('ALTER TABLE motor_actions ADD COLUMN error TEXT')
            if 'outcome' not in columns:
                connection.execute('ALTER TABLE motor_actions ADD COLUMN outcome TEXT')
            if 'command' not in columns:
                connection.execute('ALTER TABLE motor_actions ADD COLUMN command TEXT')
            if 'transaction_id' not in columns:
                connection.execute('ALTER TABLE motor_actions ADD COLUMN transaction_id INTEGER')
            if 'responses_json' not in columns:
                connection.execute('ALTER TABLE motor_actions ADD COLUMN responses_json TEXT')

    def create_motor_action(self, workflow_session: str, station: str, operation: str) -> dict:
        if station not in MOTOR_STATIONS or operation not in {'OPEN', 'CLOSE'}:
            raise ValueError('Invalid station or operation for motor action.')
        action_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connection() as connection:
            connection.execute('''
                INSERT INTO motor_actions (
                    action_id, workflow_session, station, operation,
                    created_at, updated_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
                ON CONFLICT(workflow_session, station, operation) DO NOTHING
            ''', (action_id, str(workflow_session), station, operation, created_at, created_at))
            row = connection.execute('''
                SELECT * FROM motor_actions
                WHERE workflow_session = ? AND station = ? AND operation = ?
            ''', (str(workflow_session), station, operation)).fetchone()
            if row is None:
                raise sqlite3.IntegrityError('Unable to retrieve the persisted motor action.')
            return dict(row)

    def claim_motor_action(self, action_id: str) -> bool:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connection() as connection:
            cursor = connection.execute('''
                UPDATE motor_actions SET status = 'DISPATCHED', updated_at = ?
                WHERE action_id = ? AND status = 'PENDING'
            ''', (updated_at, action_id))
            return cursor.rowcount == 1

    def finish_motor_action(
        self,
        action_id: str,
        status: str,
        *,
        command_transmitted: bool | None = None,
        error: str | None = None,
        outcome: str | None = None,
        expected_status: str = 'DISPATCHED',
        command: str | None = None,
        transaction_id: int | None = None,
        responses: tuple[str, ...] | list[str] | None = None,
    ) -> bool:
        if status not in MOTOR_ACTION_STATUSES - set(MOTOR_ACTION_IN_PROGRESS):
            raise ValueError('Motor action status must be terminal.')
        if command_transmitted is not None and not isinstance(command_transmitted, bool):
            raise ValueError('command_transmitted must be a boolean or None.')
        if outcome is not None and outcome not in {item.value for item in MotorOutcome}:
            raise ValueError('Motor action outcome is invalid.')
        if expected_status not in MOTOR_ACTION_IN_PROGRESS:
            raise ValueError('Motor action expected status must be in progress.')
        if transaction_id is not None and (
            isinstance(transaction_id, bool)
            or not isinstance(transaction_id, int)
            or transaction_id < 1
            or transaction_id > 0xFFFFFFFF
        ):
            raise ValueError('Motor transaction ID is invalid.')
        if responses is not None and (
            not isinstance(responses, (tuple, list))
            or any(not isinstance(frame, str) for frame in responses)
        ):
            raise ValueError('Motor responses must be a list of strings.')
        updated_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connection() as connection:
            cursor = connection.execute('''
                UPDATE motor_actions
                SET status = ?, updated_at = ?, command_transmitted = ?, error = ?, outcome = ?,
                    command = ?, transaction_id = ?, responses_json = ?
                WHERE action_id = ? AND status = ?
            ''', (
                status,
                updated_at,
                None if command_transmitted is None else int(command_transmitted),
                error,
                outcome,
                command,
                transaction_id,
                json.dumps(responses or [], separators=(',', ':')),
                action_id,
                expected_status,
            ))
            return cursor.rowcount == 1

    def get_motor_action(self, action_id: str) -> dict | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                'SELECT * FROM motor_actions WHERE action_id = ?', (action_id,),
            ).fetchone()
            return dict(row) if row is not None else None

    def list_motor_actions(self) -> list[dict]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                'SELECT * FROM motor_actions ORDER BY created_at, action_id',
            ).fetchall()
            return [dict(row) for row in rows]

    def recover_in_progress_motor_actions(self) -> int:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connection() as connection:
            cursor = connection.execute('''
                UPDATE motor_actions SET status = 'UNCERTAIN', updated_at = ?
                WHERE status IN ('PENDING', 'DISPATCHED')
            ''', (updated_at,))
            return cursor.rowcount

    def append(self, event: dict) -> int:
        with self._lock, self._connection() as connection:
            cursor = connection.execute('''
                INSERT INTO scan_events (
                    uid, timestamp, status, name, student_id, role,
                    registration_required, registration_url, expires_at,
                    error, http_status, response_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                event['uid'],
                event['timestamp'],
                event['status'],
                event.get('name'),
                event.get('student_id'),
                event.get('role'),
                None if event.get('registration_required') is None else int(event['registration_required']),
                event.get('registration_url'),
                event.get('expires_at'),
                event.get('error'),
                event.get('http_status'),
                json.dumps(event.get('django_response', {}), separators=(',', ':')),
            ))
            return int(cursor.lastrowid)

    def list_after(self, after: int, limit: int) -> tuple[list[dict], bool]:
        with self._lock, self._connection() as connection:
            rows = connection.execute('''
                SELECT * FROM scan_events
                WHERE event_id > ?
                ORDER BY event_id ASC
                LIMIT ?
            ''', (after, limit + 1)).fetchall()

        has_more = len(rows) > limit
        events = []
        for row in rows[:limit]:
            event = {
                'event_id': row['event_id'],
                'uid': row['uid'],
                'timestamp': row['timestamp'],
                'status': row['status'],
                'http_status': row['http_status'],
                'django_response': json.loads(row['response_json']),
            }
            for key in ('name', 'student_id', 'role', 'registration_url', 'expires_at', 'error'):
                if row[key] is not None:
                    event[key] = row[key]
            if row['registration_required'] is not None:
                event['registration_required'] = bool(row['registration_required'])
            events.append(event)
        return events, has_more


def _safe_django_response(status_code: int, payload: dict, verifier: DjangoVerifier) -> dict:
    if status_code == 200 and payload.get('success') is True:
        allowed = (
            'success', 'registered', 'name', 'student_id', 'role', 'section',
            'event_id', 'status', 'action', 'nfc_uid', 'user', 'cabinet',
            'station', 'cabinet_session_id', 'reason',
        )
        return {key: payload[key] for key in allowed if key in payload}
    if status_code == 404 and payload.get('registration_required') is True:
        allowed = (
            'success', 'registered', 'registration_required', 'registration_url', 'expires_at', 'error',
            'event_id', 'status', 'action', 'nfc_uid', 'user', 'cabinet',
            'station', 'cabinet_session_id', 'reason',
        )
        response = {key: payload[key] for key in allowed if key in payload}
        if 'error' in response:
            response['error'] = sanitize_error(response['error'], getattr(verifier, 'api_key', ''))
        return response
    error = sanitize_error(payload.get('error') or f'Django verification failed with HTTP {status_code}.', getattr(verifier, 'api_key', ''))
    audit_keys = (
        'event_id', 'status', 'action', 'nfc_uid', 'user', 'cabinet',
        'station', 'cabinet_session_id', 'reason',
    )
    response = {key: payload[key] for key in audit_keys if key in payload}
    response.update({'success': False, 'error': error})
    return response


def make_scan_event(uid: str, verifier: DjangoVerifier) -> dict:
    uid = normalize_uid(uid)
    if not uid:
        raise ValueError('NFC UID is required.')

    timestamp = datetime.now(timezone.utc).isoformat()
    try:
        http_status, payload = verifier.verify(uid)
    except DjangoRequestError as error:
        message = sanitize_error(error, getattr(verifier, 'api_key', ''))
        return {
            'uid': uid,
            'timestamp': timestamp,
            'status': 'error',
            'error': message,
            'http_status': error.http_status,
            'django_response': {'success': False, 'error': message},
        }

    safe_response = _safe_django_response(http_status, payload, verifier)
    if http_status == 200 and safe_response.get('success') is True:
        status = 'registered'
    elif http_status == 404 and safe_response.get('registration_required') is True:
        status = 'unregistered'
    else:
        status = 'error'

    event = {
        'uid': uid,
        'timestamp': timestamp,
        'status': status,
        'http_status': http_status,
        'django_response': safe_response,
    }
    if status == 'registered':
        for key in ('name', 'student_id', 'role'):
            if key in safe_response:
                event[key] = safe_response[key]
    elif status == 'unregistered':
        event['registration_required'] = True
        for key in ('registration_url', 'expires_at', 'error'):
            if key in safe_response:
                event[key] = safe_response[key]
    else:
        event['error'] = safe_response['error']
    return event


class NFCServiceState:
    def __init__(self, reader_connected: bool = False) -> None:
        self.reader_connected = reader_connected
        self.state = 'waiting' if reader_connected else 'error'
        self.uid: str | None = None
        self.event_id = 0
        self.error = None if reader_connected else 'Waiting for the IC Reader.'
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                'service': 'ready',
                'reader_connected': self.reader_connected,
                'state': self.state,
                'uid': self.uid,
                'event_id': self.event_id,
                'error': self.error,
            }

    def card_detected(self, uid: str, event_id: int | None = None) -> None:
        with self._lock:
            self.uid = uid
            self.state = 'detected'
            self.error = None
            self.event_id = event_id if event_id is not None else self.event_id + 1

    def card_removed(self) -> None:
        with self._lock:
            self.uid = None
            self.state = 'waiting' if self.reader_connected else 'error'

    def reader_error(self, message: str) -> None:
        with self._lock:
            self.uid = None
            self.state = 'error'
            self.error = message


class NFCService:
    def __init__(
        self,
        reader,
        store: SQLiteScanEventStore,
        verifier: DjangoVerifier,
        photo_capture=None,
        motor_controller=None,
        motor_actuation_enabled: bool | None = None,
    ):
        self.reader = reader
        self.store = store
        self.verifier = verifier
        self.photo_capture = photo_capture if photo_capture is not None else getattr(verifier, 'photo_capture', None)
        selected_motor_controller = motor_controller if motor_controller is not None else create_motor_controller()
        if not callable(getattr(selected_motor_controller, 'command', None)) or not callable(
            getattr(selected_motor_controller, 'close', None)
        ):
            raise TypeError('Motor controller must provide command() and close() methods.')
        self.motor_controller = selected_motor_controller
        if motor_actuation_enabled is not None and not isinstance(motor_actuation_enabled, bool):
            raise TypeError('motor_actuation_enabled must be a boolean.')
        self.motor_actuation_enabled = _motor_actuation_enabled() if motor_actuation_enabled is None else motor_actuation_enabled
        self._motor_command_lock = threading.Lock()
        if self.store is not None:
            self.recovered_motor_actions = self.store.recover_in_progress_motor_actions()
        else:
            self.recovered_motor_actions = 0
        self.state = NFCServiceState(getattr(reader, 'reader_connected', False))
        self._stop_event = threading.Event()
        self._recovery_lock = threading.RLock()
        self._active_recovery: dict | None = None
        self._recovery_expiry_timer: threading.Timer | None = None
        self._recovery_snapshot: dict | None = None

    @staticmethod
    def _validate_recovery_request_id(request_id: object) -> str:
        if (
            not isinstance(request_id, str)
            or not request_id
            or len(request_id) > PASSWORD_RECOVERY_MAX_REQUEST_ID_LENGTH
            or request_id != request_id.strip()
            or not request_id.isascii()
            or any(not character.isprintable() or character.isspace() for character in request_id)
        ):
            raise ValueError('A valid password-reset request ID is required.')
        return request_id

    @staticmethod
    def _handoff_ttl(payload: dict) -> int:
        expires_at = payload.get('expires_at')
        if expires_at is None:
            return PASSWORD_RECOVERY_DEFAULT_TTL_SECONDS
        if not isinstance(expires_at, str):
            raise ValueError('Django returned an invalid password-reset expiry.')
        try:
            expiry = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
        except ValueError as error:
            raise ValueError('Django returned an invalid password-reset expiry.') from error
        remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            raise DjangoRequestError('This password-reset request has expired.', HTTPStatus.GONE)
        return max(1, min(int(remaining), PASSWORD_RECOVERY_MAX_TTL_SECONDS))

    def start_password_recovery(self, request_id: str) -> dict:
        request_id = self._validate_recovery_request_id(request_id)
        with self._recovery_lock:
            if self._active_recovery is not None:
                if self._active_recovery.get('scan_claimed'):
                    raise RuntimeError('Password-recovery verification is already in progress.')
                if self._active_recovery['expires_at_monotonic'] <= time.monotonic():
                    self._expire_password_recovery(request_id=self._active_recovery['request_id'])
                else:
                    raise RuntimeError('A password-recovery handoff is already active.')
            if not callable(getattr(self.verifier, 'password_reset_request', None)):
                raise DjangoRequestError('The Django password-reset bridge is unavailable.')
            status_code, payload = self.verifier.password_reset_request(
                'cabinet-handoff',
                {'request_id': request_id},
            )
            if status_code < 200 or status_code >= 300:
                detail = payload.get('error') or payload.get('detail')
                lowered_detail = str(detail or '').strip().lower()
                if status_code == HTTPStatus.NOT_FOUND and lowered_detail in {
                    'not found', 'not found.', 'page not found', 'page not found.',
                }:
                    message = (
                        'The configured Django server does not expose the password-recovery endpoint. '
                        'Check TAPTRACK_DJANGO_API_BASE_URL.'
                    )
                elif status_code == HTTPStatus.NOT_FOUND:
                    message = (
                        'This recovery request is unavailable on the configured Django server. '
                        'Start again from the password-reset page and confirm both services use the same Django API.'
                    )
                elif status_code == HTTPStatus.GONE:
                    message = 'This password-reset request has expired. Start again to create a new request.'
                elif status_code == HTTPStatus.CONFLICT:
                    message = 'This password-reset request is already in use or is no longer available.'
                elif status_code == HTTPStatus.BAD_REQUEST:
                    message = 'The password-reset request ID is invalid. Start again from the password-reset page.'
                elif status_code in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN):
                    message = 'Django rejected the reader service authentication. Contact support.'
                else:
                    message = 'The password-reset service could not accept this request. Please try again later.'
                raise DjangoRequestError(
                    message,
                    status_code,
                )
            if payload.get('request_id') != request_id:
                raise DjangoRequestError('Django returned a mismatched password-reset request.', HTTPStatus.BAD_GATEWAY)
            try:
                ttl = self._handoff_ttl(payload)
            except ValueError as error:
                raise DjangoRequestError(str(error), HTTPStatus.BAD_GATEWAY) from error
            expires_at = payload.get('expires_at')
            if expires_at is None:
                expires_at = datetime.fromtimestamp(time.time() + ttl, timezone.utc).isoformat()
            self._active_recovery = {
                'request_id': request_id,
                'expires_at': expires_at,
                'expires_at_monotonic': time.monotonic() + ttl,
            }
            self._recovery_snapshot = {
                'request_id': request_id,
                'state': 'waiting',
                'message': 'Request accepted. Tap the NFC card linked to this account.',
            }
            timer = threading.Timer(ttl, self._expire_password_recovery, kwargs={'request_id': request_id})
            timer.daemon = True
            self._recovery_expiry_timer = timer
            timer.start()
            return dict(self._recovery_snapshot, expires_at=expires_at)

    def _expire_password_recovery(self, request_id: str) -> None:
        with self._recovery_lock:
            if self._active_recovery is None or self._active_recovery['request_id'] != request_id:
                return
            self._active_recovery = None
            self._recovery_expiry_timer = None
            self._recovery_snapshot = {
                'request_id': request_id,
                'state': 'expired',
                'message': 'Password-recovery handoff expired. Start a new request.',
            }

    def cancel_password_recovery(self, request_id: str | None = None) -> dict:
        with self._recovery_lock:
            active = self._active_recovery
            if active is None:
                return {'cancelled': False}
            if request_id is not None and request_id != active['request_id']:
                raise ValueError('The active password-reset request does not match.')
            if active.get('scan_claimed'):
                raise RuntimeError('NFC recovery verification is already in progress.')
            self._active_recovery = None
            if self._recovery_expiry_timer is not None:
                self._recovery_expiry_timer.cancel()
                self._recovery_expiry_timer = None
            self._recovery_snapshot = {
                'request_id': active['request_id'],
                'state': 'cancelled',
                'message': 'Password-recovery handoff cancelled.',
            }
            return {'cancelled': True}

    def password_recovery_snapshot(self, request_id: str | None = None) -> dict:
        with self._recovery_lock:
            if self._active_recovery is not None and self._active_recovery['expires_at_monotonic'] <= time.monotonic():
                self._expire_password_recovery(self._active_recovery['request_id'])
            snapshot = self._recovery_snapshot
            if snapshot is None or (request_id is not None and snapshot.get('request_id') != request_id):
                return {'state': 'idle'}
            return dict(snapshot, active=self._active_recovery is not None)

    def _take_recovery_for_scan(self) -> str | None:
        with self._recovery_lock:
            if self._active_recovery is None:
                return None
            if self._active_recovery['expires_at_monotonic'] <= time.monotonic():
                self._expire_password_recovery(self._active_recovery['request_id'])
                return None
            request_id = self._active_recovery['request_id']
            if self._recovery_expiry_timer is not None:
                self._recovery_expiry_timer.cancel()
                self._recovery_expiry_timer = None
            self._active_recovery['scan_claimed'] = True
            return request_id

    def _verify_recovery_uid(self, request_id: str, uid: str) -> dict:
        message = 'NFC recovery verification failed. Start a new recovery request.'
        result = {'request_id': request_id, 'state': 'failed', 'message': message}
        try:
            normalized_uid = normalize_uid(uid)
            if not normalized_uid:
                raise ValueError('NFC UID is required.')
            status_code, payload = self.verifier.password_reset_request(
                'verify-nfc',
                {'request_id': request_id, 'nfc_uid': normalized_uid},
            )
            if not isinstance(payload, dict):
                result['message'] = 'Django returned an invalid NFC verification response.'
            elif status_code == HTTPStatus.OK:
                if payload.get('request_id') != request_id or payload.get('status') != 'verified':
                    result['message'] = 'Django returned an invalid NFC verification response.'
                else:
                    result = {
                        'request_id': request_id,
                        'state': 'verified',
                        'message': 'The backend confirmed NFC recovery verification.',
                    }
            elif status_code == HTTPStatus.GONE:
                result['message'] = 'Password-reset request expired. Start a new recovery request.'
            elif status_code == HTTPStatus.CONFLICT:
                result['message'] = 'This password-reset request is already used or no longer available. Start a new request.'
            elif status_code == HTTPStatus.FORBIDDEN and 'device api key' in str(
                payload.get('error') or payload.get('detail') or '',
            ).lower():
                result['message'] = 'Django rejected reader service authentication. Contact support.'
            elif status_code in (
                HTTPStatus.BAD_REQUEST,
                HTTPStatus.FORBIDDEN,
                HTTPStatus.NOT_FOUND,
                HTTPStatus.UNPROCESSABLE_ENTITY,
            ):
                result['message'] = 'This card does not match the password-reset request.'
            elif status_code == HTTPStatus.UNAUTHORIZED:
                result['message'] = 'Django rejected device authentication. Contact support.'
            elif status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
                result['message'] = 'Password-reset service unavailable. Start a new recovery request.'
            elif status_code == HTTPStatus.OK:
                result['message'] = 'Django returned an invalid NFC verification response.'
        except (DjangoRequestError, ValueError) as error:
            result['message'] = sanitize_error(error)
        except Exception:
            logger.exception('Password-recovery NFC verification failed unexpectedly.')
            result['message'] = 'Password-reset verification failed. Start a new recovery request.'
        finally:
            with self._recovery_lock:
                if self._active_recovery is not None and self._active_recovery['request_id'] == request_id:
                    self._active_recovery = None
                if self._recovery_expiry_timer is not None:
                    self._recovery_expiry_timer.cancel()
                    self._recovery_expiry_timer = None
                self._recovery_snapshot = result
        return dict(result)

    def capture_access_log_photo(self, event_id: int) -> bool:
        if self.photo_capture is None:
            return False
        return self.photo_capture.capture(event_id)

    def status_snapshot(self) -> dict:
        status = self.state.snapshot()
        status['motor'] = {
            'mode': 'serial' if isinstance(self.motor_controller, SerialMotorController) else 'mock',
            'actuation_enabled': self.motor_actuation_enabled,
            'serial_connection': getattr(self.motor_controller, 'connection_status', 'not_applicable'),
            'armed': getattr(self.motor_controller, 'armed', False),
        }
        return status

    def recover_motor_controller(
        self,
        *,
        operator_confirmed_driver_power_isolated: bool,
        operator_confirmed_stationary: bool,
        operator_confirmed_esp32_power_cycled: bool,
    ) -> bool:
        confirmations = (
            operator_confirmed_driver_power_isolated,
            operator_confirmed_stationary,
            operator_confirmed_esp32_power_cycled,
        )
        if any(value is not True for value in confirmations):
            logger.warning('motor_recovery_refused reason=operator_confirmations_incomplete')
            return False
        if self._stop_event.is_set() or not self.motor_actuation_enabled:
            logger.warning(
                'motor_recovery_refused reason=service_stopping_or_actuation_disabled '
                'actuation_enabled=%s',
                self.motor_actuation_enabled,
            )
            return False
        if not isinstance(self.motor_controller, SerialMotorController):
            logger.warning(
                'motor_recovery_refused reason=serial_controller_not_selected controller=%s',
                type(self.motor_controller).__name__,
            )
            return False
        if not self._motor_command_lock.acquire(blocking=False):
            logger.warning('motor_recovery_refused reason=motor_action_in_progress')
            return False

        try:
            logger.info(
                'motor_recovery_started serial_connection=%s',
                self.motor_controller.connection_status,
            )
            recovered = self.motor_controller.recover(
                operator_confirmed_driver_power_isolated=True,
                operator_confirmed_stationary=True,
                operator_confirmed_esp32_power_cycled=True,
            )
            if recovered:
                logger.info(
                    'motor_recovery_result result=ready serial_connection=%s',
                    self.motor_controller.connection_status,
                )
            else:
                logger.error(
                    'motor_recovery_result result=failed reason=handshake_or_esp32_state_rejected '
                    'serial_connection=%s',
                    self.motor_controller.connection_status,
                )
            return recovered
        finally:
            self._motor_command_lock.release()

    def dispatch_motor_transition(self, command: str, station: str, status_code: int, response: dict):
        if self._stop_event.is_set():
            return None
        action = MOTOR_WORKFLOW_TRANSITIONS.get(command)
        if action is None:
            return None
        if status_code != HTTPStatus.OK:
            logger.warning(
                'motor_action_skipped workflow_action=%s station=%s reason=django_http_status status=%s',
                command,
                station,
                status_code,
            )
            return None
        if station not in MOTOR_STATIONS:
            logger.warning(
                'motor_action_skipped workflow_action=%s station=%s reason=invalid_station',
                command,
                station,
            )
            return None
        if not isinstance(response, dict) or response.get('station') != station:
            logger.warning(
                'motor_action_skipped workflow_action=%s station=%s reason=response_station_mismatch',
                command,
                station,
            )
            return None

        session = response.get('session')
        expected_status = 'open' if command == 'finish_open' else 'closed'
        if (
            not isinstance(session, dict)
            or isinstance(session.get('id'), bool)
            or not isinstance(session.get('id'), (str, int))
            or not str(session.get('id')).strip()
            or session.get('station') != station
            or session.get('status') != expected_status
            or session.get('workflow_state') != 'idle'
        ):
            logger.warning(
                'motor_action_skipped workflow_action=%s station=%s reason=invalid_workflow_response',
                command,
                station,
            )
            return None

        if self.store is None:
            logger.error(
                'motor_action_skipped workflow_action=%s station=%s reason=action_store_unavailable',
                command,
                station,
            )
            return MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.UNCERTAIN,
                error='Action persistence is unavailable; dispatch skipped.',
            )

        try:
            action_record = self.store.create_motor_action(str(session['id']), station, action)
        except Exception as error:
            logger.exception(
                'motor_action_skipped workflow_action=%s station=%s reason=action_store_write_failed error_type=%s',
                command,
                station,
                type(error).__name__,
            )
            return MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.UNCERTAIN,
                error='Action persistence failed; dispatch skipped.',
            )

        if action_record['status'] != 'PENDING':
            logger.info(
                'motor_action_reused workflow_action=%s station=%s action_id=%s state=%s',
                command,
                station,
                action_record['action_id'],
                action_record['status'],
            )
            return motor_result_from_action(action_record)
        if not self._motor_command_lock.acquire(blocking=False):
            logger.warning(
                'motor_action_skipped workflow_action=%s station=%s action_id=%s reason=another_action_in_progress',
                command,
                station,
                action_record['action_id'],
            )
            result = MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.BUSY,
                command_transmitted=False,
                error='Another motor action is in progress.',
            )
            try:
                updated = self.store.finish_motor_action(
                    action_record['action_id'],
                    'FAILED',
                    command_transmitted=False,
                    error=result.error,
                    outcome=result.outcome.value,
                    expected_status='PENDING',
                )
            except Exception:
                logger.exception(
                    'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                    'reason=busy_outcome_persistence_failed',
                    command,
                    station,
                    action_record['action_id'],
                )
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    command_transmitted=False,
                    error='Busy outcome could not be persisted; manual review is required.',
                )
            if updated:
                return result
            try:
                latest = self.store.get_motor_action(action_record['action_id'])
            except Exception:
                latest = None
            return motor_result_from_action(latest) if latest else MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.UNCERTAIN,
                command_transmitted=False,
                error='Busy action state is unavailable; manual review is required.',
            )

        try:
            try:
                claimed = self.store.claim_motor_action(action_record['action_id'])
            except Exception as error:
                logger.exception(
                    'motor_action_skipped workflow_action=%s station=%s action_id=%s '
                    'reason=action_claim_failed error_type=%s',
                    command,
                    station,
                    action_record['action_id'],
                    type(error).__name__,
                )
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    error='Action claim failed; dispatch skipped.',
                )
            if not claimed:
                try:
                    latest = self.store.get_motor_action(action_record['action_id'])
                except Exception as error:
                    logger.exception(
                        'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                        'reason=action_state_unavailable error_type=%s',
                        command,
                        station,
                        action_record['action_id'],
                        type(error).__name__,
                    )
                    return MotorCommandResult(
                        station=station,
                        action=action,
                        command='MOCK',
                        outcome=MotorOutcome.UNCERTAIN,
                        error='Action state is unavailable; manual review is required.',
                    )
                return motor_result_from_action(latest) if latest else MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    error='Action state is unavailable; dispatch skipped.',
                )

            if not self.motor_actuation_enabled:
                logger.warning(
                    'motor_action_skipped workflow_action=%s station=%s action_id=%s '
                    'reason=actuation_disabled serial_connection=%s',
                    command,
                    station,
                    action_record['action_id'],
                    getattr(self.motor_controller, 'connection_status', 'not_applicable'),
                )
                result = MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK' if isinstance(self.motor_controller, MockMotorController) else '',
                    outcome=MotorOutcome.REJECTED,
                    command_transmitted=False,
                    error=MOTOR_ACTUATION_DISABLED,
                )
                try:
                    updated = self.store.finish_motor_action(
                        action_record['action_id'],
                        'FAILED',
                        command_transmitted=False,
                        error=MOTOR_ACTUATION_DISABLED,
                        outcome=result.outcome.value,
                    )
                except Exception as error:
                    logger.exception(
                        'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                        'reason=disabled_action_persistence_failed error_type=%s',
                        command,
                        station,
                        action_record['action_id'],
                        type(error).__name__,
                    )
                    return MotorCommandResult(
                        station=station,
                        action=action,
                        command=result.command,
                        outcome=MotorOutcome.UNCERTAIN,
                        error='Disabled action could not be persisted; manual review is required.',
                    )
                if not updated:
                    logger.error(
                        'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                        'reason=disabled_action_state_changed',
                        command,
                        station,
                        action_record['action_id'],
                    )
                    return MotorCommandResult(
                        station=station,
                        action=action,
                        command=result.command,
                        outcome=MotorOutcome.UNCERTAIN,
                        error='Disabled action state changed unexpectedly; manual review is required.',
                    )
                return result

            logger.info(
                'motor_action_dispatch workflow_action=%s station=%s action_id=%s '
                'motor_command=%s serial_connection=%s controller=%s',
                command,
                station,
                action_record['action_id'],
                action,
                getattr(self.motor_controller, 'connection_status', 'not_applicable'),
                type(self.motor_controller).__name__,
            )
            try:
                result = self.motor_controller.command(station, action)
                if (
                    not isinstance(result, MotorCommandResult)
                    or not isinstance(result.outcome, MotorOutcome)
                ):
                    raise TypeError('Motor controller returned an invalid result.')
            except Exception as error:
                logger.exception(
                    'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                    'reason=controller_exception error_type=%s',
                    command,
                    station,
                    action_record['action_id'],
                    type(error).__name__,
                )
                result = MotorCommandResult(
                    station=station,
                    action=action,
                    command='',
                    outcome=MotorOutcome.UNCERTAIN,
                    command_transmitted=None,
                    error=f'{type(error).__name__}: {error}',
                )
            logger.log(
                logging.INFO if result.outcome == MotorOutcome.COMPLETED else logging.WARNING,
                'motor_action_result workflow_action=%s station=%s action_id=%s '
                'motor_command=%s result=%s '
                'serial_connection=%s transaction_id=%s reason=%s',
                command,
                station,
                action_record['action_id'],
                result.command or 'none',
                result.outcome.value,
                getattr(self.motor_controller, 'connection_status', 'not_applicable'),
                result.transaction_id,
                result.error or 'none',
            )
            action_status = {
                MotorOutcome.COMPLETED: 'COMPLETED',
                MotorOutcome.REJECTED: 'FAILED',
                MotorOutcome.BUSY: 'FAILED',
                MotorOutcome.UNCERTAIN: 'UNCERTAIN',
            }.get(result.outcome, 'UNCERTAIN')
            try:
                updated = self.store.finish_motor_action(
                    action_record['action_id'],
                    action_status,
                    command_transmitted=result.command_transmitted,
                    error=result.error,
                    outcome=result.outcome.value,
                    command=result.command,
                    transaction_id=result.transaction_id,
                    responses=result.responses,
                )
            except Exception as error:
                logger.exception(
                    'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                    'reason=outcome_persistence_failed error_type=%s',
                    command,
                    station,
                    action_record['action_id'],
                    type(error).__name__,
                )
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command=result.command,
                    outcome=MotorOutcome.UNCERTAIN,
                    session_id=result.session_id,
                    transaction_id=result.transaction_id,
                    command_transmitted=result.command_transmitted,
                    responses=result.responses,
                    error='Action outcome could not be persisted; manual review is required.',
                )
            if not updated:
                logger.error(
                    'motor_action_uncertain workflow_action=%s station=%s action_id=%s '
                    'reason=outcome_state_changed',
                    command,
                    station,
                    action_record['action_id'],
                )
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command=result.command,
                    outcome=MotorOutcome.UNCERTAIN,
                    session_id=result.session_id,
                    transaction_id=result.transaction_id,
                    command_transmitted=result.command_transmitted,
                    responses=result.responses,
                    error='Action state changed unexpectedly; manual review is required.',
                )
            return result
        finally:
            self._motor_command_lock.release()

    def process_uid(self, uid: str) -> dict:
        """Verify one completed UID and persist exactly one resulting event."""
        recovery_request_id = self._take_recovery_for_scan()
        if recovery_request_id is not None:
            result = self._verify_recovery_uid(recovery_request_id, uid)
            logger.info(
                'password_recovery_scan state=%s',
                result['state'],
            )
            return result

        event = make_scan_event(uid, self.verifier)
        event['event_id'] = self.store.append(event)
        self.state.card_detected(event['uid'], event['event_id'])
        django_response = event['django_response']
        django_event_id = django_response.get('event_id') if isinstance(django_response, dict) else None
        if isinstance(django_event_id, int) and not isinstance(django_event_id, bool) and django_event_id > 0:
            threading.Thread(
                target=self.capture_access_log_photo,
                args=(django_event_id,),
                name=f'access-photo-{django_event_id}',
                daemon=True,
            ).start()
        print(f"[NFC] UID: {event['uid']}")
        print(f"[Django] Status: {event['http_status'] if event['http_status'] is not None else 'network error'}")
        print(f"[Django] Result: {event['status']}")
        if event['status'] == 'error':
            print(f"[Django] Error: {event['error']}")
        elif event['status'] == 'registered':
            print(f"[Django] Response: {json.dumps(django_response, ensure_ascii=True)}")
        else:
            print('[Django] Response: unregistered card (registration token omitted from logs)')
        return event

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                uid = self.reader.wait_for_card()
                if not uid:
                    continue
                self.state.reader_connected = True
                self.process_uid(uid)
                self.reader.wait_for_removal()
                self.state.card_removed()
            except ReaderUnavailable as error:
                self.state.reader_error(str(error))
                self._stop_event.wait(1)
            except Exception:
                self.state.reader_error('NFC service error. Check the service logs.')
                self._stop_event.wait(1)

    def stop(self) -> None:
        self._stop_event.set()
        with self._recovery_lock:
            if self._recovery_expiry_timer is not None:
                self._recovery_expiry_timer.cancel()
                self._recovery_expiry_timer = None
            self._active_recovery = None
        close_errors = []
        for name, resource in (
            ('NFC reader', self.reader),
            ('motor controller', self.motor_controller),
        ):
            is_motor_controller = name == 'motor controller'
            if is_motor_controller:
                self._motor_command_lock.acquire()
            close = getattr(resource, 'close', None)
            try:
                if close:
                    close()
            except Exception as error:
                logger.exception('Unable to close %s cleanly.', name)
                close_errors.append(error)
            finally:
                if is_motor_controller:
                    self._motor_command_lock.release()
        if close_errors:
            raise RuntimeError('One or more NFC service resources did not close cleanly.') from close_errors[0]


class NFCHandler(BaseHTTPRequestHandler):
    server_version = 'TapTrackNFC/1.0'

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(body)

    def _send_preflight(self) -> None:
        origin = self.headers.get('Origin')
        self.send_response(HTTPStatus.NO_CONTENT)
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Accept, Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Vary', 'Origin')
        self.end_headers()

    def _read_json_body(self) -> dict:
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
            raise ValueError('Content-Type must be application/json.')
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError as error:
            raise ValueError('Invalid Content-Length.') from error
        if length < 1 or length > 4096:
            raise ValueError('Request body must be between 1 and 4096 bytes.')
        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError('Request body must be valid JSON.') from error
        if not isinstance(payload, dict):
            raise ValueError('Request body must be a JSON object.')
        return payload

    def _recovery_origin_is_allowed(self) -> bool:
        origin = self.headers.get('Origin')
        return origin in ALLOWED_ORIGINS

    def do_OPTIONS(self) -> None:
        self._send_preflight()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == '/nfc/status':
            self._send_json(HTTPStatus.OK, self.server.service.status_snapshot())
            return
        if path == '/password-reset/bridge-status':
            if not self._recovery_origin_is_allowed():
                self._send_json(HTTPStatus.FORBIDDEN, {'error': 'Password-recovery bridge origin is not allowed.'})
                return
            parameters = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            request_ids = parameters.get('request_id', [])
            if len(request_ids) != 1:
                self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'A single request_id is required.'})
                return
            try:
                request_id = NFCService._validate_recovery_request_id(request_ids[0])
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {'error': str(error)})
                return
            self._send_json(HTTPStatus.OK, self.server.service.password_recovery_snapshot(request_id))
            return
        if path == '/cabinet/workflow':
            try:
                status_code, payload = self.server.service.verifier.workflow()
                self._send_json(HTTPStatus(status_code), payload)
            except DjangoRequestError as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {'error': sanitize_error(error)})
            return
        if path != '/api/scans':
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return

        parameters = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        try:
            after_values = parameters.get('after', ['0'])
            limit_values = parameters.get('limit', [str(DEFAULT_LIMIT)])
            if len(after_values) != 1 or len(limit_values) != 1:
                raise ValueError
            after = int(after_values[0])
            requested_limit = int(limit_values[0])
            if after < 0 or requested_limit < 1:
                raise ValueError
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'after must be >= 0 and limit must be a positive integer.'})
            return

        limit = min(requested_limit, MAX_LIMIT)
        events, has_more = self.server.store.list_after(after, limit)
        next_cursor = events[-1]['event_id'] if events else after
        self._send_json(HTTPStatus.OK, {
            'events': events,
            'next_cursor': next_cursor,
            'has_more': has_more,
        })

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        service = self.server.service
        if path in ('/password-reset/handoff', '/password-reset/cancel'):
            if not self._recovery_origin_is_allowed():
                self._send_json(HTTPStatus.FORBIDDEN, {'error': 'Password-recovery bridge origin is not allowed.'})
                return
            try:
                payload = self._read_json_body()
                if set(payload) != {'request_id'}:
                    raise ValueError('Body must contain only request_id.')
                request_id = NFCService._validate_recovery_request_id(payload['request_id'])
                if path == '/password-reset/handoff':
                    result = service.start_password_recovery(request_id)
                    self._send_json(HTTPStatus.OK, result)
                else:
                    result = service.cancel_password_recovery(request_id)
                    self._send_json(HTTPStatus.OK, result)
            except DjangoRequestError as error:
                status = error.http_status
                if status is None or status < 400 or status >= 600:
                    status = HTTPStatus.BAD_GATEWAY
                self._send_json(
                    HTTPStatus(status),
                    {'error': sanitize_error(error, getattr(service.verifier, 'api_key', ''))},
                )
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {'error': str(error)})
            except RuntimeError as error:
                self._send_json(HTTPStatus.CONFLICT, {'error': sanitize_error(error)})
            return
        if path == '/photo/capture':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                event_id = payload.get('event_id')
                if isinstance(event_id, bool) or not isinstance(event_id, int) or event_id < 1:
                    self._send_json(HTTPStatus.BAD_REQUEST, {'success': False, 'error': 'A valid access event ID is required.'})
                    return
                if service.photo_capture is None:
                    self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {'success': False, 'event_id': event_id})
                    return
                captured = service.capture_access_log_photo(event_id)
                self._send_json(HTTPStatus.OK, {'success': captured, 'event_id': event_id})
            except (ValueError, json.JSONDecodeError):
                self._send_json(HTTPStatus.BAD_REQUEST, {'success': False, 'error': 'Invalid photo capture payload.'})
            return
        if path == '/cabinet/workflow':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                command = str(payload.get('command') or '')
                station = str(payload.get('station') or '').strip()
                if command not in {'open', 'finish_open', 'start_close', 'finish_close', 'cancel'}:
                    self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Unsupported cabinet workflow command.'})
                    return
                status_code, response = service.verifier.workflow(command, station)
                motor_result = service.dispatch_motor_transition(command, station, status_code, response)
                if command in MOTOR_WORKFLOW_TRANSITIONS and status_code == HTTPStatus.OK:
                    payload = dict(response) if isinstance(response, dict) else {}
                    payload['motor_dispatch'] = {
                        'workflow_action': command,
                        'outcome': motor_result.outcome.value if motor_result else 'skipped',
                        'serial_command': motor_result.command or None if motor_result else None,
                        'transaction_id': motor_result.transaction_id if motor_result else None,
                        'serial_responses': list(motor_result.responses) if motor_result else [],
                        'serial_accepted': bool(motor_result and motor_result.accepted),
                        'serial_command_completed': bool(
                            motor_result
                            and motor_result.outcome == MotorOutcome.COMPLETED
                            and motor_result.command_transmitted is True
                        ),
                        'serial_command_sent': (
                            motor_result.command_transmitted
                            if isinstance(service.motor_controller, SerialMotorController)
                            and motor_result is not None
                            else False
                        ),
                        'controller_armed': getattr(service.motor_controller, 'armed', False),
                        'serial_connection': getattr(
                            service.motor_controller,
                            'connection_status',
                            'not_applicable',
                        ),
                        'physical_movement_verified': False,
                        'error': (
                            sanitize_error(motor_result.error)
                            if motor_result and motor_result.error else
                            'Motor dispatch was skipped because the Django transition response was invalid.'
                        ),
                    }
                    response = payload
                self._send_json(HTTPStatus(status_code), response)
            except (ValueError, json.JSONDecodeError):
                self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Invalid cabinet workflow payload.'})
            except DjangoRequestError as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {'error': sanitize_error(error)})
            return
        if path not in ('/nfc/mock-scan', '/nfc/mock-remove'):
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return
        if not isinstance(service.reader, MockNFCReader):
            self._send_json(HTTPStatus.NOT_IMPLEMENTED, {'error': 'Mock NFC input is disabled.'})
            return
        try:
            if path == '/nfc/mock-remove':
                service.reader.simulate_removal()
                self._send_json(HTTPStatus.OK, {'accepted': True})
                return
            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
            service.reader.simulate_scan(str(payload.get('uid', '')))
            self._send_json(HTTPStatus.OK, {'accepted': True})
        except (ValueError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Invalid mock NFC scan payload.'})

    def log_message(self, format: str, *args) -> None:
        return None


def build_reader(mode: str | None = None, evdev_module=None):
    selected_mode = (mode or os.environ.get('TAPTRACK_NFC_MODE', 'hardware')).strip().lower()
    if selected_mode in {'mock', 'development', 'dev'}:
        return MockNFCReader()
    return EvdevNFCReader(evdev_module=evdev_module)


def create_http_server(store: SQLiteScanEventStore, service: NFCService, host: str = BRIDGE_HOST, port: int = BRIDGE_PORT):
    if host != '127.0.0.1':
        raise ValueError('The NFC bridge must bind only to 127.0.0.1.')
    server = ThreadingHTTPServer((host, port), NFCHandler)
    server.daemon_threads = True
    server.store = store
    server.service = service
    return server


def main() -> None:
    reader = build_reader()
    store = SQLiteScanEventStore()
    verifier = DjangoVerifier()
    service = NFCService(reader, store, verifier)
    server = create_http_server(store, service)
    motor_recovery_server = None
    if service.motor_actuation_enabled and isinstance(service.motor_controller, SerialMotorController):
        motor_recovery_server = MotorRecoveryServer(service)
        threading.Thread(
            target=motor_recovery_server.serve_forever,
            name='motor-operator-recovery',
            daemon=True,
        ).start()
        logger.info(
            'motor_configuration mode=serial actuation_enabled=true '
            'operator_recovery_socket=%s serial_connection=%s',
            motor_recovery_server.socket_path,
            service.motor_controller.connection_status,
        )
    else:
        logger.info(
            'motor_configuration controller=%s actuation_enabled=%s',
            type(service.motor_controller).__name__,
            service.motor_actuation_enabled,
        )
    threading.Thread(target=server.serve_forever, name='nfc-scan-bridge', daemon=True).start()
    print(f'TapTrack NFC scan bridge listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}/api/scans')
    try:
        service.run()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            service.stop()
        finally:
            if motor_recovery_server is not None:
                motor_recovery_server.shutdown()
                motor_recovery_server.server_close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()