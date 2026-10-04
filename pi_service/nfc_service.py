"""Read NFC cards, verify once with Django, and expose persistent local results."""

from __future__ import annotations

import json
import os
import re
import queue
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
from urllib.parse import parse_qs, urlsplit

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


class DjangoVerifier:
    """Make the one server-side verification request for a completed UID."""

    def __init__(self, url: str = DJANGO_VERIFY_URL, api_key: str | None = None, opener=None):
        self.url = url
        self.api_key = api_key if api_key is not None else (
            os.environ.get('DEVICE_API_KEY') or os.environ.get('TAPTRACK_DEVICE_API_KEY', '')
        ).strip()
        self.opener = opener

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

    def workflow(self, command: str | None = None) -> tuple[int, dict]:
        if not self.api_key:
            raise DjangoRequestError('Django device API key is not configured.')

        body = None if command is None else json.dumps({'command': command}).encode('utf-8')
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
    def __init__(self, reader, store: SQLiteScanEventStore, verifier: DjangoVerifier):
        self.reader = reader
        self.store = store
        self.verifier = verifier
        self.state = NFCServiceState(getattr(reader, 'reader_connected', False))
        self._stop_event = threading.Event()

    def process_uid(self, uid: str) -> dict:
        """Verify one completed UID and persist exactly one resulting event."""
        event = make_scan_event(uid, self.verifier)
        event['event_id'] = self.store.append(event)
        self.state.card_detected(event['uid'], event['event_id'])
        django_response = event['django_response']
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
        if path == '/cabinet/workflow':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                command = str(payload.get('command') or '')
                if command not in {'open', 'finish_open', 'start_close', 'finish_close', 'cancel'}:
                    self._send_json(HTTPStatus.BAD_REQUEST, {'error': 'Unsupported cabinet workflow command.'})
                    return
                status_code, response = service.verifier.workflow(command)
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