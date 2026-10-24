"""Read NFC cards, verify once with Django, and expose persistent local results."""

from __future__ import annotations

import json
import logging
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

from motor_controller import MotorCommandResult, MotorOutcome
from reader_adapters import EvdevNFCReader, ReaderUnavailable, normalize_uid


BRIDGE_HOST = '127.0.0.1'
BRIDGE_PORT = 5001
DJANGO_VERIFY_URL = os.environ.get(
    'TAPTRACK_DJANGO_VERIFY_URL',
    'http://127.0.0.1:8000/api/verify-nfc/',
)
DJANGO_WORKFLOW_URL = os.environ.get(
    'TAPTRACK_DJANGO_WORKFLOW_URL',
    'http://127.0.0.1:8000/api/cabinet/workflow/',
)
DATABASE_PATH = Path(os.environ.get(
    'TAPTRACK_NFC_DB_PATH',
    str(Path(__file__).resolve().with_name('nfc_events.sqlite3')),
))
ALLOWED_ORIGINS = frozenset({
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5176',
    'http://localhost:5176',
})
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
REQUEST_TIMEOUT_SECONDS = 5
PHOTO_CAPTURE_URL = 'http://192.168.1.61/capture'
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MOTOR_WORKFLOW_TRANSITIONS = {
    'finish_open': 'OPEN',
    'finish_close': 'CLOSE',
}
MOTOR_STATIONS = frozenset({'Station 1', 'Station 2'})
MOTOR_ACTION_STATUSES = frozenset({'PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'UNCERTAIN'})
MOTOR_ACTION_IN_PROGRESS = ('PENDING', 'DISPATCHED')

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

    def command(self, station: str, action: str) -> MotorCommandResult:
        with self._lock:
            self.calls.append((station, action))
            transaction_id = len(self.calls)
        return MotorCommandResult(
            station=station,
            action=action,
            command='MOCK',
            outcome=MotorOutcome.COMPLETED,
            session_id='MOCK-ONLY',
            transaction_id=transaction_id,
        )


def motor_result_from_action(action: dict) -> MotorCommandResult:
    outcomes = {
        'PENDING': MotorOutcome.BUSY,
        'DISPATCHED': MotorOutcome.UNCERTAIN,
        'COMPLETED': MotorOutcome.COMPLETED,
        'FAILED': MotorOutcome.REJECTED,
        'UNCERTAIN': MotorOutcome.UNCERTAIN,
    }
    operation = action['operation']
    return MotorCommandResult(
        station=action['station'],
        action=operation,
        command='MOCK',
        outcome=outcomes[action['status']],
        transaction_id=None,
        error='Action requires manual review.' if action['status'] == 'UNCERTAIN' else None,
    )


def create_motor_controller():
    if os.environ.get('TAPTRACK_MOTOR_ACTUATION_ENABLED', '').strip().lower() in {'1', 'true', 'yes', 'on'}:
        raise RuntimeError('Real motor actuation is disabled in this mock-only integration phase.')
    return MockMotorController()


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

    def __init__(self, url: str = DJANGO_VERIFY_URL, api_key: str | None = None, opener=None):
        self.url = url
        self.api_key = api_key if api_key is not None else (
            os.environ.get('DEVICE_API_KEY') or os.environ.get('TAPTRACK_DEVICE_API_KEY', '')
        ).strip()
        self.opener = opener
        self.photo_capture = DjangoPhotoCapture(self.url, self.api_key, opener=opener) if self.api_key else None

    def _sanitize_error(self, value: object) -> str:
        return sanitize_error(value, self.api_key)

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
            DJANGO_WORKFLOW_URL,
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
                    UNIQUE (workflow_session, station, operation)
                )
            ''')

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

    def finish_motor_action(self, action_id: str, status: str) -> bool:
        if status not in MOTOR_ACTION_STATUSES - set(MOTOR_ACTION_IN_PROGRESS):
            raise ValueError('Motor action status must be terminal.')
        updated_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connection() as connection:
            cursor = connection.execute('''
                UPDATE motor_actions SET status = ?, updated_at = ?
                WHERE action_id = ? AND status = 'DISPATCHED'
            ''', (status, updated_at, action_id))
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
    ):
        self.reader = reader
        self.store = store
        self.verifier = verifier
        self.photo_capture = photo_capture if photo_capture is not None else getattr(verifier, 'photo_capture', None)
        selected_motor_controller = motor_controller if motor_controller is not None else create_motor_controller()
        if not isinstance(selected_motor_controller, MockMotorController):
            raise RuntimeError('Only MockMotorController is allowed in this integration phase.')
        self.motor_controller = selected_motor_controller
        self._motor_command_lock = threading.Lock()
        if self.store is not None:
            self.recovered_motor_actions = self.store.recover_in_progress_motor_actions()
        else:
            self.recovered_motor_actions = 0
        self.state = NFCServiceState(getattr(reader, 'reader_connected', False))
        self._stop_event = threading.Event()

    def capture_access_log_photo(self, event_id: int) -> bool:
        if self.photo_capture is None:
            return False
        return self.photo_capture.capture(event_id)

    def dispatch_motor_transition(self, command: str, station: str, status_code: int, response: dict):
        action = MOTOR_WORKFLOW_TRANSITIONS.get(command)
        if action is None or status_code != HTTPStatus.OK or station not in MOTOR_STATIONS:
            return None
        if not isinstance(response, dict) or response.get('station') != station:
            return None

        session = response.get('session')
        expected_status = 'open' if command == 'finish_open' else 'closed'
        if (
            not isinstance(session, dict)
            or session.get('id') is None
            or session.get('station') != station
            or session.get('status') != expected_status
            or session.get('workflow_state') != 'idle'
        ):
            return None

        if self.store is None:
            logger.error('Motor action persistence is unavailable; dispatch skipped.')
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
            logger.error('Unable to persist motor action (%s); dispatch skipped.', type(error).__name__)
            return MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.UNCERTAIN,
                error='Action persistence failed; dispatch skipped.',
            )

        if action_record['status'] != 'PENDING':
            return motor_result_from_action(action_record)
        if not self._motor_command_lock.acquire(blocking=False):
            return MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=MotorOutcome.BUSY,
                error='Another motor action is in progress.',
            )

        try:
            try:
                claimed = self.store.claim_motor_action(action_record['action_id'])
            except Exception as error:
                logger.error('Unable to claim motor action (%s); dispatch skipped.', type(error).__name__)
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
                    logger.error('Unable to read motor action state (%s); manual review is required.', type(error).__name__)
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

            try:
                result = self.motor_controller.command(station, action)
                if not isinstance(result, MotorCommandResult):
                    raise TypeError('Motor controller returned an invalid result.')
            except Exception:
                result = MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    error='Motor dispatch outcome is uncertain; automatic retry is disabled.',
                )
            action_status = {
                MotorOutcome.COMPLETED: 'COMPLETED',
                MotorOutcome.REJECTED: 'FAILED',
                MotorOutcome.BUSY: 'UNCERTAIN',
                MotorOutcome.UNCERTAIN: 'UNCERTAIN',
            }.get(result.outcome, 'UNCERTAIN')
            try:
                updated = self.store.finish_motor_action(action_record['action_id'], action_status)
            except Exception as error:
                logger.error('Unable to persist motor action outcome (%s); action requires recovery.', type(error).__name__)
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    error='Action outcome could not be persisted; manual review is required.',
                )
            if not updated:
                logger.error('Motor action state changed unexpectedly; action requires recovery.')
                return MotorCommandResult(
                    station=station,
                    action=action,
                    command='MOCK',
                    outcome=MotorOutcome.UNCERTAIN,
                    error='Action state changed unexpectedly; manual review is required.',
                )
            return result
        finally:
            self._motor_command_lock.release()

    def process_uid(self, uid: str) -> dict:
        """Verify one completed UID and persist exactly one resulting event."""
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
        close = getattr(self.reader, 'close', None)
        if close:
            close()


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

    def do_OPTIONS(self) -> None:
        self._send_preflight()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == '/nfc/status':
            self._send_json(HTTPStatus.OK, self.server.service.state.snapshot())
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
                service.dispatch_motor_transition(command, station, status_code, response)
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
    threading.Thread(target=server.serve_forever, name='nfc-scan-bridge', daemon=True).start()
    print(f'TapTrack NFC scan bridge listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}/api/scans')
    try:
        service.run()
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()