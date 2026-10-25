import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from nfc_service import (
    ALLOWED_ORIGINS,
    BRIDGE_HOST,
    BRIDGE_PORT,
    DjangoRequestError,
    DjangoVerifier,
    DjangoPhotoCapture,
    MockNFCReader,
    MockMotorController,
    NFCService,
    SQLiteScanEventStore,
    create_motor_controller,
    create_http_server,
    make_scan_event,
    normalize_uid,
)
from reader_adapters import EvdevNFCReader, ReaderUnavailable, UIDKeyParser, build_key_map
from motor_controller import MotorCommandResult, MotorOutcome, SerialMotorController


class FakeVerifier:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []
        self.password_reset_calls = []

    def verify(self, uid):
        self.calls.append(uid)
        if self.error:
            raise self.error
        return self.result

    def password_reset_request(self, endpoint, payload):
        self.password_reset_calls.append((endpoint, payload))
        if endpoint == 'cabinet-handoff':
            return 200, {'request_id': payload['request_id']}
        if endpoint == 'verify-nfc':
            return 403, {'error': 'NFC card does not match this password-reset request.'}
        raise AssertionError(f'Unexpected password-reset endpoint: {endpoint}')


class FakeMotorController(MockMotorController):
    def __init__(self, outcome=MotorOutcome.COMPLETED, block=False, error=None, events=None):
        super().__init__()
        self.outcome = outcome
        self.block = block
        self.error = error
        self.events = events
        self.command_transmitted = False
        self.calls = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self._lock = threading.Lock()
        self.in_flight = 0
        self.max_in_flight = 0

    def command(self, station, action):
        with self._lock:
            self.calls.append((station, action))
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
        if self.events is not None:
            self.events.append('motor')
        self.entered.set()
        try:
            if self.block:
                self.release.wait(timeout=2)
            if self.error:
                raise self.error
            return MotorCommandResult(
                station=station,
                action=action,
                command='MOCK',
                outcome=self.outcome,
                transaction_id=len(self.calls),
                command_transmitted=self.command_transmitted,
                responses=(f'RSP,2,MOCK,{len(self.calls)},ACCEPTED,MOCK',),
            )
        finally:
            with self._lock:
                self.in_flight -= 1


class FakeProtocolSerial:
    def __init__(self):
        self.responses = []
        self.writes = []
        self.last_transaction_id = 0
        self.command_response_mode = 'success'
        self.timeout = None

    @property
    def in_waiting(self):
        return sum(len(frame) for frame in self.responses)

    def write(self, frame):
        self.writes.append(frame)
        fields = frame.decode('ascii').rstrip('\n').split(',')
        if fields[0] == 'HELLO':
            self.responses.append(
                f'READY,2,0123456789abcdef,{fields[2]},{self.last_transaction_id},IDLE\n'.encode('ascii')
            )
        elif fields[0] == 'CMD':
            self.last_transaction_id = int(fields[3])
            if self.command_response_mode == 'success':
                statuses = ('ACCEPTED', 'BUSY', 'DONE')
                for response_status in statuses:
                    self.responses.append(
                        f'RSP,2,{fields[2]},{fields[3]},{response_status},{fields[4]}\n'.encode('ascii')
                    )
            elif self.command_response_mode == 'malformed':
                self.responses.append(b'NOT_A_V2_RESPONSE\n')
        return len(frame)

    def flush(self):
        pass

    def read_until(self, expected=b'\n', size=None):
        return self.responses.pop(0) if self.responses else b''

    def close(self):
        pass


class FakeResponse:
    def __init__(self, status, payload, headers=None):
        self.status = status
        self._body = payload if isinstance(payload, bytes) else json.dumps(payload).encode('utf-8')
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self._body if size < 0 else self._body[:size]


def make_fake_ecodes():
    values = {'EV_KEY': 1, 'KEY_ENTER': 28}
    values.update({f'KEY_{digit}': index + 2 for index, digit in enumerate('0123456789')})
    values.update({f'KEY_{letter}': index + 20 for index, letter in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ')})
    return SimpleNamespace(**values)


class FakeInputDevice:
    def __init__(self, path, name, events):
        self.path = path
        self.name = name
        self.events = events
        self.closed = False

    def read_loop(self):
        yield from self.events

    def close(self):
        self.closed = True


class FakeEvdev:
    def __init__(self, devices, ecodes):
        self.devices = devices
        self.ecodes = ecodes

    def list_devices(self):
        return [device.path for device in self.devices]

    def InputDevice(self, path):
        return next(device for device in self.devices if device.path == path)


@patch.dict(os.environ, {'TAPTRACK_MOTOR_MODE': 'mock', 'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false'})
class NFCServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / 'scan-events.sqlite3'
        self.store = SQLiteScanEventStore(self.database_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_uid_normalization_remains_stable(self):
        self.assertEqual(normalize_uid(' 04 a1-22 '), '04A1-22')

    def test_key_parser_collects_key_downs_until_enter(self):
        ecodes = make_fake_ecodes()
        key_map = build_key_map(ecodes)
        parser = UIDKeyParser(ecodes, key_map=key_map)
        events = [
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_1),
            SimpleNamespace(type=ecodes.EV_KEY, value=0, code=ecodes.KEY_2),
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_2),
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_ENTER),
        ]

        self.assertIsNone(parser.feed(events[0], now=1.0))
        self.assertIsNone(parser.feed(events[1], now=1.01))
        self.assertIsNone(parser.feed(events[2], now=1.02))
        self.assertEqual(parser.feed(events[3], now=1.03), '12')
        self.assertIsNone(parser.feed(events[3], now=1.04))

    def test_key_parser_resets_partial_uid_after_inter_key_timeout(self):
        ecodes = make_fake_ecodes()
        parser = UIDKeyParser(ecodes)
        parser.feed(SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_1), now=1.0)
        parser.feed(SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_2), now=2.0)
        enter = SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_ENTER)

        self.assertEqual(parser.feed(enter, now=2.1), '2')

    def test_evdev_reader_selects_ic_reader_and_reads_uid(self):
        ecodes = make_fake_ecodes()
        events = [
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_1),
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_2),
            SimpleNamespace(type=ecodes.EV_KEY, value=1, code=ecodes.KEY_ENTER),
        ]
        unrelated = FakeInputDevice('/dev/input/event0', 'Keyboard', [])
        reader_device = FakeInputDevice('/dev/input/event5', 'IC Reader IC Reader', events)
        reader = EvdevNFCReader(FakeEvdev([unrelated, reader_device], ecodes))

        self.assertEqual(reader.wait_for_card(), '12')
        self.assertTrue(unrelated.closed)

    def test_evdev_reader_reports_missing_device(self):
        reader = EvdevNFCReader(FakeEvdev([], make_fake_ecodes()))
        with self.assertRaises(ReaderUnavailable):
            reader.wait_for_card()

    def test_django_verifier_posts_once_with_uid_and_server_key(self):
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(200, {
                'success': True,
                'name': 'Avery Example',
                'student_id': 'STU-001',
                'role': 'student',
            })

        verifier = DjangoVerifier(api_key='unit-test-key', opener=opener)
        status, payload = verifier.verify('12AB')

        self.assertEqual(status, 200)
        self.assertEqual(payload['student_id'], 'STU-001')
        self.assertEqual(len(calls), 1)
        request, timeout = calls[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:8000/api/verify-nfc/')
        self.assertEqual(json.loads(request.data), {'nfc_uid': '12AB'})
        self.assertEqual(request.get_header('X-api-key'), 'unit-test-key')
        self.assertEqual(timeout, 5)

    def test_photo_capture_uses_fresh_camera_image_and_matching_django_event_ids(self):
        requests = []
        camera_images = [b'\xff\xd8fresh-image-one', b'\xff\xd8fresh-image-two']
        uploaded_event_ids = set()

        def opener(request, timeout):
            requests.append(request)
            path = request.full_url.replace('http://django.test/api', '')
            if request.full_url == 'http://192.168.1.61/capture':
                image = camera_images.pop(0)
                return FakeResponse(200, image, {'Content-Type': 'image/jpeg'})
            if request.get_method() == 'GET':
                event_id = int(path.split('/')[2])
                return FakeResponse(200, {
                    'event_id': event_id,
                    'capture_status': 'success' if event_id in uploaded_event_ids else None,
                    'image_available': event_id in uploaded_event_ids,
                })
            if path.endswith('/photo-status/'):
                event_id = int(path.split('/')[2])
                return FakeResponse(200, {'success': True, 'event_id': event_id})
            event_id = int(path.split('/')[2])
            uploaded_event_ids.add(event_id)
            return FakeResponse(201, {'success': True, 'event_id': event_id})

        capture = DjangoPhotoCapture(
            'http://django.test/api/verify-nfc/',
            'server-only-test-key',
            opener=opener,
        )

        self.assertTrue(capture.capture(81))
        first_request_count = len(requests)
        self.assertTrue(capture.capture(81))
        self.assertEqual(len(requests), first_request_count + 1)
        self.assertEqual(
            sum(request.full_url == 'http://192.168.1.61/capture' for request in requests),
            1,
        )
        self.assertTrue(capture.capture(82))

        camera_requests = [request for request in requests if request.full_url == 'http://192.168.1.61/capture']
        upload_requests = [request for request in requests if request.get_method() == 'POST' and '/photo/' in request.full_url]
        self.assertEqual(len(camera_requests), 2)
        self.assertTrue(all(request.get_header('X-api-key') is None for request in camera_requests))
        self.assertEqual([int(request.full_url.split('/')[5]) for request in upload_requests], [81, 82])
        self.assertIn(b'fresh-image-one', requests[3].data)
        self.assertIn(b'fresh-image-two', requests[-1].data)
        self.assertTrue(all(request.get_header('X-api-key') == 'server-only-test-key' for request in upload_requests))

    def test_camera_failure_is_reported_for_the_same_event(self):
        requests = []

        def opener(request, timeout):
            requests.append(request)
            if request.full_url.endswith('/photo/'):
                event_id = int(request.full_url.split('/')[-3])
                return FakeResponse(200, {'event_id': event_id, 'capture_status': None, 'image_available': False})
            if request.full_url.endswith('/photo-status/'):
                event_id = int(request.full_url.split('/')[-3])
                return FakeResponse(200, {'success': True, 'event_id': event_id})
            return FakeResponse(503, b'camera unavailable')

        capture = DjangoPhotoCapture('http://django.test/api/verify-nfc/', 'test-key', opener=opener)

        self.assertFalse(capture.capture(95))
        failure_request = requests[-1]
        self.assertTrue(failure_request.full_url.endswith('/api/access-logs/95/photo-status/'))
        self.assertEqual(json.loads(failure_request.data), {
            'status': 'failed',
            'error': 'Camera capture failed or returned an invalid JPEG image.',
        })

    def test_scan_capture_uses_only_the_django_event_id(self):
        class PhotoCapture:
            def __init__(self):
                self.event_ids = []
                self.captured = threading.Event()

            def capture(self, event_id):
                self.event_ids.append(event_id)
                self.captured.set()
                return True

        photo_capture = PhotoCapture()
        verifier = FakeVerifier((200, {
            'success': True,
            'event_id': 703,
            'name': 'Avery Example',
            'student_id': 'STU-001',
            'role': 'student',
        }))
        service = NFCService(MockNFCReader(), self.store, verifier, photo_capture=photo_capture)

        scan_event = service.process_uid('TWO-TAPS')
        self.assertTrue(photo_capture.captured.wait(timeout=1))

        self.assertEqual(scan_event['event_id'], 1)
        self.assertEqual(scan_event['django_response']['event_id'], 703)
        self.assertEqual(photo_capture.event_ids, [703])

    def test_django_workflow_proxy_uses_device_key_and_forwards_selected_station(self):
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(200, {'station': 'Station 1', 'session': {'id': 4}})

        verifier = DjangoVerifier(api_key='workflow-device-key', opener=opener)
        status, payload = verifier.workflow('open', 'Station 2')

        self.assertEqual(status, 200)
        self.assertEqual(payload['station'], 'Station 1')
        request, timeout = calls[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:8000/api/cabinet/workflow/')
        self.assertEqual(json.loads(request.data), {'command': 'open', 'station': 'Station 2'})
        self.assertEqual(request.get_header('X-api-key'), 'workflow-device-key')
        self.assertEqual(timeout, 5)

    def test_password_recovery_proxy_uses_device_key_and_exact_endpoint_contracts(self):
        requests = []

        def opener(request, timeout):
            requests.append((request, timeout))
            return FakeResponse(200, {'request_id': 'opaque-id', 'status': 'verified'})

        verifier = DjangoVerifier(api_key='recovery-device-key', opener=opener)
        handoff_status, handoff = verifier.password_reset_request(
            'cabinet-handoff',
            {'request_id': 'opaque-id'},
        )
        verify_status, verified = verifier.password_reset_request(
            'verify-nfc',
            {'request_id': 'opaque-id', 'nfc_uid': 'AA00FF'},
        )

        self.assertEqual((handoff_status, verify_status), (200, 200))
        self.assertEqual(handoff['request_id'], 'opaque-id')
        self.assertEqual(verified['status'], 'verified')
        self.assertEqual(requests[0][0].full_url, 'http://127.0.0.1:8000/api/auth/password-reset/cabinet-handoff/')
        self.assertEqual(json.loads(requests[0][0].data), {'request_id': 'opaque-id'})
        self.assertEqual(requests[1][0].full_url, 'http://127.0.0.1:8000/api/auth/password-reset/verify-nfc/')
        self.assertEqual(json.loads(requests[1][0].data), {'request_id': 'opaque-id', 'nfc_uid': 'AA00FF'})
        self.assertTrue(all(request.get_header('X-api-key') == 'recovery-device-key' for request, _ in requests))
        self.assertTrue(all(timeout == 5 for _, timeout in requests))

    def test_registered_django_response_becomes_one_registered_event(self):
        verifier = FakeVerifier((200, {
            'success': True,
            'event_id': 9031,
            'name': 'Avery Example',
            'student_id': 'STU-001',
            'role': 'student',
        }))
        service = NFCService(MockNFCReader(), self.store, verifier)

        event = service.process_uid(' 12 34 ')
        stored, has_more = self.store.list_after(0, 50)

        self.assertEqual(event['status'], 'registered')
        self.assertEqual(event['uid'], '1234')
        self.assertEqual(event['event_id'], 1)
        self.assertEqual(event['django_response']['event_id'], 9031)
        self.assertEqual(stored[0]['event_id'], 1)
        self.assertEqual(stored[0]['django_response']['event_id'], 9031)
        self.assertNotEqual(event['event_id'], event['django_response']['event_id'])
        self.assertEqual(event['name'], 'Avery Example')
        self.assertEqual(event['student_id'], 'STU-001')
        self.assertEqual(event['role'], 'student')
        self.assertEqual(len(verifier.calls), 1)
        self.assertEqual(len(stored), 1)
        self.assertFalse(has_more)

    def test_nfc_scan_never_dispatches_a_motor_transition(self):
        verifier = FakeVerifier((200, {
            'success': True,
            'event_id': 9031,
            'name': 'Avery Example',
            'student_id': 'STU-001',
            'role': 'student',
        }))
        service = NFCService(MockNFCReader(), self.store, verifier)

        event = service.process_uid('NFC-SCAN-ONLY')

        self.assertEqual(event['status'], 'registered')
        self.assertEqual(service.motor_controller.calls, [])

    def test_unregistered_404_response_preserves_registration_fields(self):
        payload = {
            'success': False,
            'registered': False,
            'registration_required': True,
            'registration_url': 'http://portal/register?token=fake-test-token',
            'expires_at': '2026-10-01T12:00:00+00:00',
            'error': 'NFC card not registered.',
        }
        verifier = FakeVerifier((404, payload))
        service = NFCService(MockNFCReader(), self.store, verifier)

        event = service.process_uid('CARD-UNKNOWN')

        self.assertEqual(event['status'], 'unregistered')
        self.assertTrue(event['registration_required'])
        self.assertEqual(event['registration_url'], payload['registration_url'])
        self.assertEqual(event['expires_at'], payload['expires_at'])
        self.assertEqual(event['error'], payload['error'])
        self.assertEqual(event['http_status'], 404)
        self.assertEqual(len(verifier.calls), 1)

    def test_server_error_response_becomes_error_event(self):
        verifier = FakeVerifier((503, {'error': 'Django is unavailable.'}))
        service = NFCService(MockNFCReader(), self.store, verifier)

        event = service.process_uid('ERR-503')

        self.assertEqual(event['status'], 'error')
        self.assertEqual(event['http_status'], 503)
        self.assertEqual(event['error'], 'Django is unavailable.')

    def test_network_failure_becomes_sanitized_error_event(self):
        verifier = FakeVerifier(error=DjangoRequestError('Unable to reach Django.'))
        service = NFCService(MockNFCReader(), self.store, verifier)

        event = service.process_uid('ERR-NET')

        self.assertEqual(event['status'], 'error')
        self.assertIsNone(event['http_status'])
        self.assertEqual(event['error'], 'Unable to reach Django.')

    def test_api_key_is_not_stored_in_event(self):
        def opener(request, timeout):
            return FakeResponse(403, {'error': 'Invalid API key: never-store-this-key'})

        verifier = DjangoVerifier(api_key='never-store-this-key', opener=opener)
        service = NFCService(MockNFCReader(), self.store, verifier)
        service.process_uid('UID-1')
        stored, _ = self.store.list_after(0, 10)

        self.assertNotIn('never-store-this-key', json.dumps(stored))
        self.assertEqual(stored[0]['status'], 'error')
        self.assertEqual(stored[0]['error'], 'Invalid API key: [redacted]')

    def test_cursor_orders_multiple_events_and_does_not_delete_them(self):
        verifier = FakeVerifier((200, {'success': True, 'name': 'A', 'student_id': 'A1', 'role': 'student'}))
        service = NFCService(MockNFCReader(), self.store, verifier)
        first = service.process_uid('UID-A')
        second = service.process_uid('UID-B')

        page, has_more = self.store.list_after(0, 1)
        repeated, repeated_has_more = self.store.list_after(0, 5)
        next_page, next_has_more = self.store.list_after(first['event_id'], 5)

        self.assertEqual([event['event_id'] for event in page], [first['event_id']])
        self.assertTrue(has_more)
        self.assertEqual([event['event_id'] for event in repeated], [1, 2])
        self.assertFalse(repeated_has_more)
        self.assertEqual([event['event_id'] for event in next_page], [second['event_id']])
        self.assertFalse(next_has_more)

    def test_polling_same_cursor_does_not_verify_or_create_events(self):
        verifier = FakeVerifier((200, {'success': True, 'name': 'A', 'student_id': 'A1', 'role': 'student'}))
        service = NFCService(MockNFCReader(), self.store, verifier)
        service.process_uid('ONE-TAP')

        first_read, _ = self.store.list_after(0, 50)
        second_read, _ = self.store.list_after(0, 50)

        self.assertEqual(len(verifier.calls), 1)
        self.assertEqual(first_read, second_read)
        self.assertEqual(len(second_read), 1)

    def test_empty_cursor_returns_supplied_cursor(self):
        events, has_more = self.store.list_after(41, 50)
        self.assertEqual(events, [])
        self.assertFalse(has_more)

    def test_sqlite_events_survive_reopening_the_store(self):
        event = self.store.append({
            'uid': 'PERSIST-1',
            'timestamp': '2026-10-01T00:00:00+00:00',
            'status': 'error',
            'error': 'test failure',
            'django_response': {'error': 'test failure'},
        })
        reopened = SQLiteScanEventStore(self.database_path)

        events, _ = reopened.list_after(0, 10)
        self.assertEqual(events[0]['event_id'], event)
        self.assertEqual(events[0]['uid'], 'PERSIST-1')

    def test_existing_motor_action_database_adds_dispatch_result_columns(self):
        legacy_database = Path(self.temp_dir.name) / 'legacy-motor-actions.sqlite3'
        connection = sqlite3.connect(legacy_database)
        try:
            connection.execute('''
                CREATE TABLE motor_actions (
                    action_id TEXT PRIMARY KEY,
                    workflow_session TEXT NOT NULL,
                    station TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    status TEXT NOT NULL
                )
            ''')
        finally:
            connection.close()

        SQLiteScanEventStore(legacy_database)

        connection = sqlite3.connect(legacy_database)
        try:
            columns = {
                row[1]
                for row in connection.execute('PRAGMA table_info(motor_actions)')
            }
        finally:
            connection.close()
        self.assertIn('command_transmitted', columns)
        self.assertIn('error', columns)
        self.assertIn('outcome', columns)
        self.assertIn('command', columns)
        self.assertIn('transaction_id', columns)
        self.assertIn('responses_json', columns)

    def test_concurrent_sqlite_writes_receive_unique_event_ids(self):
        def write(index):
            return self.store.append({
                'uid': f'THREAD-{index}',
                'timestamp': '2026-10-01T00:00:00+00:00',
                'status': 'error',
                'error': 'test failure',
                'django_response': {'error': 'test failure'},
            })

        with ThreadPoolExecutor(max_workers=8) as executor:
            event_ids = list(executor.map(write, range(24)))
        events, _ = self.store.list_after(0, 50)

        self.assertEqual(len(set(event_ids)), 24)
        self.assertEqual([event['event_id'] for event in events], sorted(event_ids))

    def test_reader_build_defaults_to_real_hardware_and_keeps_mock_option(self):
        self.assertIsInstance(__import__('nfc_service').build_reader(mode='mock'), MockNFCReader)
        self.assertIsInstance(__import__('nfc_service').build_reader(mode='hardware', evdev_module=FakeEvdev([], make_fake_ecodes())), EvdevNFCReader)


@patch.dict(os.environ, {'TAPTRACK_MOTOR_MODE': 'mock', 'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false'})
class MotorDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / 'motor-actions.sqlite3'
        self.store = SQLiteScanEventStore(self.database_path)
        self.controller = FakeMotorController()
        self.service = NFCService(
            MockNFCReader(),
            self.store,
            FakeVerifier((200, {})),
            motor_controller=self.controller,
            motor_actuation_enabled=True,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def response(session_id, station, status):
        return {
            'station': station,
            'session': {
                'id': session_id,
                'station': station,
                'status': status,
                'workflow_state': 'idle',
            },
        }

    def dispatch(self, command='finish_open', station='Station 1', status=200, payload=None):
        if payload is None:
            session_status = 'open' if command == 'finish_open' else 'closed'
            payload = self.response('session-1', station, session_status)
        return self.service.dispatch_motor_transition(command, station, status, payload)

    def test_factory_requires_an_explicit_known_mode_and_strict_boolean_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'explicitly set'):
                create_motor_controller()
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'hardware',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false',
        }):
            with self.assertRaisesRegex(RuntimeError, 'mock or serial'):
                create_motor_controller()
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'mock',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false',
        }):
            self.assertIsInstance(create_motor_controller(), MockMotorController)
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'mock',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'true',
        }):
            with self.assertRaisesRegex(RuntimeError, 'cannot be true in mock mode'):
                create_motor_controller()
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'mock',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'sometimes',
        }):
            with self.assertRaisesRegex(RuntimeError, 'must be true or false'):
                create_motor_controller()
        with self.assertRaisesRegex(TypeError, 'command\\(\\) and close\\(\\)'):
            NFCService(
                MockNFCReader(),
                self.store,
                FakeVerifier((200, {})),
                motor_controller=object(),
                motor_actuation_enabled=False,
            )

    def test_serial_factory_requires_stable_device_path_and_never_opens_it(self):
        serial_environment = {
            'TAPTRACK_MOTOR_MODE': 'serial',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false',
            'TAPTRACK_MOTOR_SERIAL_DEVICE': '/dev/serial/by-id/usb-TapTrack-controller',
            'TAPTRACK_MOTOR_BAUD_RATE': '115200',
            'TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS': '10',
        }
        with patch.dict(os.environ, serial_environment):
            controller = create_motor_controller()
        self.assertIsInstance(controller, SerialMotorController)
        self.assertEqual(controller.device, serial_environment['TAPTRACK_MOTOR_SERIAL_DEVICE'])
        self.assertEqual(controller.baud_rate, 115200)
        self.assertEqual(controller.response_timeout, 10)
        self.assertIsNone(controller._serial)

        for invalid_timeout in ('nan', 'inf', '0'):
            with self.subTest(timeout=invalid_timeout), patch.dict(os.environ, {
                **serial_environment,
                'TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS': invalid_timeout,
            }):
                with self.assertRaisesRegex(RuntimeError, 'positive'):
                    create_motor_controller()

        for invalid_device in (
            '',
            '/dev/ttyACM0',
            '/dev/serial/by-id/<exact-device-id>',
            '/dev/serial/by-id/../ttyACM0',
            '/dev/serial/by-id/',
        ):
            with self.subTest(device=invalid_device), patch.dict(os.environ, {
                **serial_environment,
                'TAPTRACK_MOTOR_SERIAL_DEVICE': invalid_device,
            }):
                with self.assertRaisesRegex(RuntimeError, 'stable'):
                    create_motor_controller()

    def test_serial_actuation_enable_requires_every_safety_confirmation(self):
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'serial',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'true',
            'TAPTRACK_MOTOR_SERIAL_DEVICE': '/dev/serial/by-id/usb-TapTrack-controller',
        }):
            with self.assertRaisesRegex(RuntimeError, 'limit switches, an emergency stop'):
                create_motor_controller()

    def test_disabled_actuation_records_final_transition_without_calling_controller(self):
        service = NFCService(
            MockNFCReader(),
            self.store,
            FakeVerifier((200, {})),
            motor_controller=self.controller,
            motor_actuation_enabled=False,
        )
        result = service.dispatch_motor_transition(
            'finish_open',
            'Station 1',
            200,
            self.response('disabled-session', 'Station 1', 'open'),
        )
        self.assertEqual(result.outcome, MotorOutcome.REJECTED)
        self.assertIn('no serial command was sent', result.error)
        self.assertEqual(self.controller.calls, [])
        action = self.store.list_motor_actions()[0]
        self.assertEqual(action['status'], 'FAILED')
        self.assertEqual(action['command_transmitted'], 0)
        self.assertIn('no serial command was sent', action['error'])

    def test_service_shutdown_closes_reader_and_shared_motor_controller(self):
        reader_closed = []

        class ClosableReader(MockNFCReader):
            def close(self):
                reader_closed.append(True)

        controller = FakeMotorController()
        service = NFCService(
            ClosableReader(),
            self.store,
            FakeVerifier((200, {})),
            motor_controller=controller,
            motor_actuation_enabled=False,
        )
        service.stop()
        self.assertEqual(reader_closed, [True])
        self.assertTrue(controller.closed)

    def test_shutdown_waits_for_in_flight_motor_action_before_closing_controller(self):
        events = []

        class TrackingController(FakeMotorController):
            def close(self):
                events.append('close')
                super().close()

        controller = TrackingController(block=True, events=events)
        service = NFCService(
            MockNFCReader(),
            self.store,
            FakeVerifier((200, {})),
            motor_controller=controller,
            motor_actuation_enabled=True,
        )
        dispatch_results = []
        worker = threading.Thread(target=lambda: dispatch_results.append(self.dispatch_with_service(
            service,
            'shutdown-session',
        )))
        worker.start()
        self.assertTrue(controller.entered.wait(timeout=1))

        shutdown = threading.Thread(target=service.stop)
        shutdown.start()
        self.assertFalse(controller.closed)
        controller.release.set()
        worker.join(timeout=2)
        shutdown.join(timeout=2)

        self.assertFalse(worker.is_alive())
        self.assertFalse(shutdown.is_alive())
        self.assertEqual(events, ['motor', 'close'])
        self.assertEqual(dispatch_results[0].outcome, MotorOutcome.COMPLETED)

    def dispatch_with_service(self, service, session_id):
        return service.dispatch_motor_transition(
            'finish_open',
            'Station 1',
            200,
            self.response(session_id, 'Station 1', 'open'),
        )

    def test_only_validated_successful_final_transitions_dispatch(self):
        self.dispatch()
        self.dispatch(
            command='finish_close',
            station='Station 2',
            payload=self.response('session-2', 'Station 2', 'closed'),
        )

        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN'), ('Station 2', 'CLOSE')])

    def test_get_nonfinal_invalid_and_failed_transitions_do_not_dispatch(self):
        valid_open = self.response('session-1', 'Station 1', 'open')
        cases = (
            (None, 'Station 1', 200, valid_open),
            ('open', 'Station 1', 200, valid_open),
            ('start_close', 'Station 1', 200, valid_open),
            ('cancel', 'Station 1', 200, valid_open),
            ('finish_open', 'Station 3', 200, valid_open),
            ('finish_open', 'Station 1', 403, valid_open),
            ('finish_open', 'Station 1', 409, valid_open),
            ('finish_open', 'Station 1', 200, ['not', 'a', 'response', 'object']),
            ('finish_open', 'Station 1', 200, {'station': 'Station 1'}),
            ('finish_open', 'Station 1', 200, {
                'station': 'Station 1',
                'session': {
                    'station': 'Station 1',
                    'status': 'open',
                    'workflow_state': 'idle',
                },
            }),
            ('finish_open', 'Station 1', 200, self.response(True, 'Station 1', 'open')),
            ('finish_open', 'Station 1', 200, self.response('   ', 'Station 1', 'open')),
            ('finish_open', 'Station 1', 200, self.response('session-1', 'Station 2', 'open')),
            ('finish_open', 'Station 1', 200, self.response('session-1', 'Station 1', 'opening')),
        )
        for command, station, status, payload in cases:
            with self.subTest(command=command, station=station, status=status):
                self.service.dispatch_motor_transition(command, station, status, payload)

        self.assertEqual(self.controller.calls, [])

    def test_serial_mode_constructs_one_shared_controller_and_closes_it_on_shutdown(self):
        controller = FakeMotorController()
        with patch.dict(os.environ, {
            'TAPTRACK_MOTOR_MODE': 'serial',
            'TAPTRACK_MOTOR_ACTUATION_ENABLED': 'false',
            'TAPTRACK_MOTOR_SERIAL_DEVICE': '/dev/serial/by-id/usb-TapTrack-controller',
        }):
            with patch('nfc_service.SerialMotorController', return_value=controller) as factory:
                service = NFCService(MockNFCReader(), self.store, FakeVerifier((200, {})))

        factory.assert_called_once()
        self.assertIs(service.motor_controller, controller)
        service.stop()
        self.assertTrue(controller.closed)

    def test_duplicate_transition_reuses_durable_action_without_redispatch(self):
        first = self.dispatch()
        duplicate = self.dispatch()

        self.assertEqual(duplicate.outcome, first.outcome)
        self.assertEqual(duplicate.command, first.command)
        self.assertEqual(duplicate.transaction_id, first.transaction_id)
        self.assertEqual(duplicate.command_transmitted, first.command_transmitted)
        self.assertEqual(duplicate.responses, first.responses)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        actions = self.store.list_motor_actions()
        self.assertEqual(len(actions), 1)
        self.assertTrue(actions[0]['action_id'])
        self.assertEqual(actions[0]['workflow_session'], 'session-1')
        self.assertEqual(actions[0]['station'], 'Station 1')
        self.assertEqual(actions[0]['operation'], 'OPEN')
        self.assertTrue(actions[0]['created_at'])
        self.assertEqual(actions[0]['status'], 'COMPLETED')
        self.assertEqual(actions[0]['outcome'], MotorOutcome.COMPLETED.value)
        self.assertEqual(actions[0]['command'], 'MOCK')
        self.assertEqual(actions[0]['transaction_id'], 1)

    def test_uncertain_result_is_cached_and_never_retried(self):
        self.controller.outcome = MotorOutcome.UNCERTAIN

        first = self.dispatch()
        duplicate = self.dispatch()

        self.assertEqual(first.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(duplicate.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        self.assertEqual(self.store.list_motor_actions()[0]['status'], 'UNCERTAIN')

    def test_rejected_result_persists_failed_terminal_status(self):
        self.controller.outcome = MotorOutcome.REJECTED

        result = self.dispatch()

        self.assertEqual(result.outcome, MotorOutcome.REJECTED)
        self.assertEqual(self.store.list_motor_actions()[0]['status'], 'FAILED')

    def test_controller_exception_is_cached_as_uncertain_without_retry(self):
        self.controller.error = OSError('simulated serial failure')

        first = self.dispatch()
        duplicate = self.dispatch()

        self.assertEqual(first.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(duplicate.outcome, MotorOutcome.UNCERTAIN)
        self.assertIsNone(first.command_transmitted)
        self.assertIsNone(duplicate.command_transmitted)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        self.assertEqual(self.store.list_motor_actions()[0]['status'], 'UNCERTAIN')

    def test_concurrent_transitions_never_call_controller_concurrently(self):
        self.controller.block = True
        first_result = []
        worker = threading.Thread(target=lambda: first_result.append(self.dispatch()))
        worker.start()
        self.assertTrue(self.controller.entered.wait(timeout=1))

        second = self.dispatch(
            command='finish_close',
            station='Station 2',
            payload=self.response('session-2', 'Station 2', 'closed'),
        )
        self.controller.release.set()
        worker.join(timeout=2)

        self.assertFalse(worker.is_alive())
        self.assertEqual(first_result[0].outcome, MotorOutcome.COMPLETED)
        self.assertEqual(second.outcome, MotorOutcome.BUSY)
        self.assertEqual(self.controller.max_in_flight, 1)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        busy_action = next(
            action for action in self.store.list_motor_actions()
            if action['workflow_session'] == 'session-2'
        )
        self.assertEqual(busy_action['status'], 'FAILED')
        self.assertEqual(busy_action['outcome'], 'busy')
        self.assertEqual(busy_action['command_transmitted'], 0)
        duplicate_busy = self.dispatch(
            command='finish_close',
            station='Station 2',
            payload=self.response('session-2', 'Station 2', 'closed'),
        )
        self.assertEqual(duplicate_busy.outcome, MotorOutcome.BUSY)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])

    def test_concurrent_duplicate_transition_dispatches_only_once(self):
        self.controller.block = True
        first_result = []
        worker = threading.Thread(target=lambda: first_result.append(self.dispatch()))
        worker.start()
        self.assertTrue(self.controller.entered.wait(timeout=1))

        duplicate = self.dispatch()
        self.controller.release.set()
        worker.join(timeout=2)

        self.assertFalse(worker.is_alive())
        self.assertEqual(first_result[0].outcome, MotorOutcome.COMPLETED)
        self.assertEqual(duplicate.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(self.controller.max_in_flight, 1)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        self.assertEqual(self.dispatch().outcome, MotorOutcome.COMPLETED)

    def test_concurrent_services_share_the_durable_idempotency_claim(self):
        second_store = SQLiteScanEventStore(self.database_path)
        second_controller = FakeMotorController()
        second_service = NFCService(
            MockNFCReader(), second_store, FakeVerifier((200, {})),
            motor_controller=second_controller,
            motor_actuation_enabled=True,
        )
        barrier = threading.Barrier(2)
        results = []

        def dispatch(service):
            barrier.wait(timeout=1)
            results.append(service.dispatch_motor_transition(
                'finish_open', 'Station 1', 200,
                self.response('shared-session', 'Station 1', 'open'),
            ))

        workers = [
            threading.Thread(target=dispatch, args=(service,))
            for service in (self.service, second_service)
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=2)

        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(len(self.controller.calls) + len(second_controller.calls), 1)
        self.assertEqual(len(self.store.list_motor_actions()), 1)
        self.assertEqual(self.store.list_motor_actions()[0]['status'], 'COMPLETED')

    def test_service_startup_recovers_pending_and_dispatched_actions_as_uncertain(self):
        pending = self.store.create_motor_action('pending-session', 'Station 1', 'OPEN')
        dispatched = self.store.create_motor_action('dispatched-session', 'Station 2', 'CLOSE')
        self.assertTrue(self.store.claim_motor_action(dispatched['action_id']))
        restarted_store = SQLiteScanEventStore(self.database_path)
        restarted_controller = FakeMotorController()
        restarted_service = NFCService(
            MockNFCReader(),
            restarted_store,
            FakeVerifier((200, {})),
            motor_controller=restarted_controller,
            motor_actuation_enabled=True,
        )

        self.assertEqual(restarted_service.recovered_motor_actions, 2)
        self.assertEqual(restarted_store.get_motor_action(pending['action_id'])['status'], 'UNCERTAIN')
        self.assertEqual(restarted_store.get_motor_action(dispatched['action_id'])['status'], 'UNCERTAIN')
        retry = restarted_service.dispatch_motor_transition(
            'finish_close', 'Station 2', 200,
            self.response('dispatched-session', 'Station 2', 'closed'),
        )
        self.assertEqual(retry.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(restarted_controller.calls, [])

    def test_persistence_errors_before_dispatch_never_call_controller(self):
        with patch.object(self.store, 'create_motor_action', side_effect=sqlite3.OperationalError('storage unavailable')):
            result = self.dispatch()
        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(self.controller.calls, [])

        self.store.create_motor_action('claim-failure', 'Station 1', 'OPEN')
        with patch.object(self.store, 'claim_motor_action', side_effect=sqlite3.OperationalError('storage unavailable')):
            result = self.dispatch(payload=self.response('claim-failure', 'Station 1', 'open'))
        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(self.controller.calls, [])

    def test_outcome_persistence_error_leaves_dispatched_action_unretryable(self):
        self.controller.command_transmitted = True
        with patch.object(self.store, 'finish_motor_action', side_effect=sqlite3.OperationalError('storage unavailable')):
            result = self.dispatch()

        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertTrue(result.command_transmitted)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])
        self.assertEqual(self.store.list_motor_actions()[0]['status'], 'DISPATCHED')
        retry = self.dispatch()
        self.assertEqual(retry.outcome, MotorOutcome.UNCERTAIN)
        self.assertEqual(self.controller.calls, [('Station 1', 'OPEN')])


class NFCBridgeHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = SQLiteScanEventStore(Path(self.temp_dir.name) / 'http-events.sqlite3')
        self.service = NFCService(
            MockNFCReader(),
            self.store,
            FakeVerifier((200, {})),
            motor_controller=MockMotorController(),
            motor_actuation_enabled=False,
        )
        self.server = create_http_server(self.store, self.service, host='127.0.0.1', port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.service.stop()
        self.temp_dir.cleanup()

    def get_json(self, path, origin=None):
        headers = {'Origin': origin} if origin else {}
        with urllib.request.urlopen(urllib.request.Request(self.url + path, headers=headers)) as response:
            return response.status, response.headers, json.loads(response.read().decode('utf-8'))

    def post_json(self, path, payload, origin='http://127.0.0.1:4000'):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        request = urllib.request.Request(
            self.url + path,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST',
        )
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode('utf-8'))

    def test_bridge_binds_to_loopback_default_and_has_expected_port(self):
        self.assertEqual(BRIDGE_HOST, '127.0.0.1')
        self.assertEqual(BRIDGE_PORT, 5001)
        self.assertEqual(self.server.server_address[0], '127.0.0.1')

    def test_nfc_status_reports_motor_mode_without_claiming_physical_readiness(self):
        serial_controller = SerialMotorController(
            device='/dev/serial/by-id/usb-TapTrack-test-controller',
        )
        self.service.motor_controller = serial_controller
        self.service.motor_actuation_enabled = False

        status, _, payload = self.get_json('/nfc/status')

        self.assertEqual(status, 200)
        self.assertEqual(payload['motor'], {
            'mode': 'serial',
            'actuation_enabled': False,
            'serial_connection': 'disconnected',
            'armed': False,
        })
        self.assertIsNone(serial_controller._serial)

    def test_api_scans_empty_result_preserves_cursor(self):
        status, _, body = self.get_json('/api/scans?after=19&limit=50')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'events': [], 'next_cursor': 19, 'has_more': False})

    def test_password_recovery_handoff_routes_only_the_next_card_to_django(self):
        status, handoff = self.post_json('/password-reset/handoff', {'request_id': 'opaque-reset-id-123'})

        self.assertEqual(status, 200)
        self.assertEqual(handoff['state'], 'waiting')
        self.assertEqual(handoff['request_id'], 'opaque-reset-id-123')
        status, _, bridge_status = self.get_json(
            '/password-reset/bridge-status?request_id=opaque-reset-id-123',
            origin='http://127.0.0.1:4000',
        )
        self.assertEqual(status, 200)
        self.assertEqual(bridge_status['state'], 'waiting')
        self.assertEqual(self.service.verifier.password_reset_calls, [
            ('cabinet-handoff', {'request_id': 'opaque-reset-id-123'}),
        ])

        result = self.service.process_uid('12-34-56')

        self.assertEqual(result['state'], 'failed')
        self.assertIn('does not match', result['message'])
        self.assertEqual(self.service.verifier.password_reset_calls[-1], (
            'verify-nfc',
            {'request_id': 'opaque-reset-id-123', 'nfc_uid': '12-34-56'},
        ))
        self.assertEqual(self.service.verifier.calls, [])
        self.assertEqual(self.store.list_after(0, 50), ([], False))
        self.assertEqual(self.service.motor_controller.calls, [])
        self.assertEqual(self.service.password_recovery_snapshot('opaque-reset-id-123')['state'], 'failed')

        self.service.verifier.result = (200, {'success': True})
        normal_scan = self.service.process_uid('A1-B2-C3')
        self.assertEqual(normal_scan['status'], 'registered')
        self.assertEqual(self.service.verifier.calls, ['A1-B2-C3'])
        self.assertEqual(len(self.store.list_after(0, 50)[0]), 1)
        self.assertEqual(self.service.motor_controller.calls, [])

    def test_password_recovery_rejects_concurrent_handoff_and_origin_or_body_errors(self):
        self.post_json('/password-reset/handoff', {'request_id': 'first-id'})
        with self.assertRaises(urllib.error.HTTPError) as conflict:
            self.post_json('/password-reset/handoff', {'request_id': 'second-id'})
        self.assertEqual(conflict.exception.code, 409)
        self.assertEqual(len(self.service.verifier.password_reset_calls), 1)

        request = urllib.request.Request(
            self.url + '/password-reset/handoff',
            data=json.dumps({'request_id': 'third-id'}).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'Origin': 'https://not-allowed.example'},
            method='POST',
        )
        with self.assertRaises(urllib.error.HTTPError) as forbidden:
            urllib.request.urlopen(request)
        self.assertEqual(forbidden.exception.code, 403)
        self.assertEqual(len(self.service.verifier.password_reset_calls), 1)

        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.post_json('/password-reset/cancel', {'request_id': 'first-id', 'extra': True})
        self.assertEqual(invalid.exception.code, 400)
        self.assertTrue(self.service.cancel_password_recovery('first-id')['cancelled'])

    def test_verified_recovery_never_enters_normal_access_or_motor_dispatch(self):
        class SuccessfulRecoveryVerifier(FakeVerifier):
            def password_reset_request(self, endpoint, payload):
                self.password_reset_calls.append((endpoint, payload))
                if endpoint == 'cabinet-handoff':
                    return 200, {'request_id': payload['request_id']}
                return 200, {
                    'request_id': payload['request_id'],
                    'status': 'verified',
                    'message': 'Identity verified by cabinet NFC.',
                }

        self.service.verifier = SuccessfulRecoveryVerifier((200, {'success': True}))
        self.post_json('/password-reset/handoff', {'request_id': 'success-id'})
        result = self.service.process_uid('AA-BB-CC')

        self.assertEqual(result['state'], 'verified')
        self.assertNotIn('reset_token', result)
        self.assertEqual(self.service.verifier.calls, [])
        self.assertEqual(self.service.verifier.password_reset_calls[-1], (
            'verify-nfc',
            {'request_id': 'success-id', 'nfc_uid': 'AA-BB-CC'},
        ))
        self.assertEqual(self.store.list_after(0, 50), ([], False))
        self.assertEqual(self.service.motor_controller.calls, [])

    def test_recovery_rejects_success_shaped_response_without_verified_status(self):
        class SuccessOnlyRecoveryVerifier(FakeVerifier):
            def password_reset_request(self, endpoint, payload):
                self.password_reset_calls.append((endpoint, payload))
                if endpoint == 'cabinet-handoff':
                    return 200, {'request_id': payload['request_id']}
                return 200, {'request_id': payload['request_id'], 'success': True}

        self.service.verifier = SuccessOnlyRecoveryVerifier((200, {'success': True}))
        self.post_json('/password-reset/handoff', {'request_id': 'not-verified-id'})
        result = self.service.process_uid('AA-BB-CC')

        self.assertEqual(result['state'], 'failed')
        self.assertIn('invalid NFC verification response', result['message'])

    def test_decoy_recovery_request_does_not_reveal_account_mismatch(self):
        class DecoyRecoveryVerifier(FakeVerifier):
            def password_reset_request(self, endpoint, payload):
                self.password_reset_calls.append((endpoint, payload))
                if endpoint == 'cabinet-handoff':
                    return 200, {'request_id': payload['request_id']}
                return 404, {'error': 'Reset request is unavailable.'}

        self.service.verifier = DecoyRecoveryVerifier((200, {'success': True}))
        self.post_json('/password-reset/handoff', {'request_id': 'decoy-request-id'})
        result = self.service.process_uid('AA-BB-CC')

        self.assertEqual(result['state'], 'failed')
        self.assertIn('does not match', result['message'])

    def test_password_recovery_handoff_failure_and_expiry_release_reader_mode(self):
        class FailingHandoffVerifier(FakeVerifier):
            def password_reset_request(self, endpoint, payload):
                self.password_reset_calls.append((endpoint, payload))
                return 410, {'error': 'This password-reset request has expired.'}

        self.service.verifier = FailingHandoffVerifier((200, {}))
        with self.assertRaises(urllib.error.HTTPError) as expired:
            self.post_json('/password-reset/handoff', {'request_id': 'expired-id'})
        self.assertEqual(expired.exception.code, 410)
        self.assertEqual(self.service.password_recovery_snapshot()['state'], 'idle')

        self.service.verifier = FakeVerifier((200, {}))
        self.service.verifier.result = (200, {'success': True})
        self.post_json('/password-reset/handoff', {'request_id': 'expires-soon'})
        self.service._expire_password_recovery('expires-soon')
        self.assertEqual(self.service.password_recovery_snapshot('expires-soon')['state'], 'expired')
        scan = self.service.process_uid('NORMAL-CARD')
        self.assertEqual(scan['status'], 'registered')
        self.assertEqual(self.service.verifier.calls, ['NORMAL-CARD'])
        self.assertEqual(self.service.motor_controller.calls, [])

    def test_cabinet_workflow_get_and_post_proxy_to_django(self):
        class WorkflowVerifier:
            def __init__(self):
                self.commands = []

            def workflow(self, command=None, station=None):
                self.commands.append((command, station))
                return 200, {'station': 'Station 1', 'session': {'workflow_state': command or 'idle'}}

        verifier = WorkflowVerifier()
        self.service.verifier = verifier

        get_status, _, current = self.get_json('/cabinet/workflow')
        post_status, opened = self.post_json('/cabinet/workflow', {'command': 'open', 'station': 'Station 2'})

        self.assertEqual(get_status, 200)
        self.assertEqual(post_status, 200)
        self.assertEqual(verifier.commands, [(None, None), ('open', 'Station 2')])
        self.assertEqual(current['station'], 'Station 1')
        self.assertEqual(opened['session']['workflow_state'], 'open')
        self.assertEqual(self.service.motor_controller.calls, [])

    def test_successful_final_transition_dispatches_after_django_confirms_success(self):
        events = []

        class SuccessfulWorkflowVerifier:
            def workflow(self, command=None, station=None):
                events.append('django')
                return 200, {
                    'station': station,
                    'session': {
                        'id': 42,
                        'station': station,
                        'status': 'open',
                        'workflow_state': 'idle',
                    },
                }

        controller = FakeMotorController(events=events)
        self.service.verifier = SuccessfulWorkflowVerifier()
        self.service.motor_controller = controller
        self.service.motor_actuation_enabled = True

        status, payload = self.post_json('/cabinet/workflow', {
            'command': 'finish_open',
            'station': 'Station 1',
        })

        self.assertEqual(status, 200)
        self.assertEqual(payload['session']['status'], 'open')
        self.assertEqual(payload['motor_dispatch']['outcome'], 'completed')
        self.assertFalse(payload['motor_dispatch']['serial_command_sent'])
        self.assertFalse(payload['motor_dispatch']['physical_movement_verified'])
        self.assertEqual(events, ['django', 'motor'])
        self.assertEqual(controller.calls, [('Station 1', 'OPEN')])

    def test_disabled_motor_dispatch_is_returned_to_the_cabinet_ui(self):
        class SuccessfulWorkflowVerifier:
            def workflow(self, command=None, station=None):
                return 200, {
                    'mode': 'hardware',
                    'station': station,
                    'session': {
                        'id': 'disabled-session',
                        'station': station,
                        'status': 'open',
                        'workflow_state': 'idle',
                        'opened_by': [],
                        'closed_by': [],
                    },
                }

        self.service.verifier = SuccessfulWorkflowVerifier()

        status, payload = self.post_json('/cabinet/workflow', {
            'command': 'finish_open',
            'station': 'Station 1',
        })

        self.assertEqual(status, 200)
        self.assertEqual(payload['session']['workflow_state'], 'idle')
        self.assertEqual(payload['motor_dispatch']['workflow_action'], 'finish_open')
        self.assertEqual(payload['motor_dispatch']['outcome'], 'rejected')
        self.assertFalse(payload['motor_dispatch']['serial_command_sent'])
        self.assertFalse(payload['motor_dispatch']['physical_movement_verified'])
        self.assertIn('no serial command was sent', payload['motor_dispatch']['error'])
        self.assertEqual(self.service.motor_controller.calls, [])
        _, duplicate_payload = self.post_json('/cabinet/workflow', {
            'command': 'finish_open',
            'station': 'Station 1',
        })
        self.assertFalse(duplicate_payload['motor_dispatch']['serial_command_sent'])
        self.assertIn('no serial command was sent', duplicate_payload['motor_dispatch']['error'])

    def test_disarmed_serial_controller_does_not_report_a_command_as_sent(self):
        class SuccessfulWorkflowVerifier:
            def workflow(self, command=None, station=None):
                return 200, {
                    'mode': 'hardware',
                    'station': station,
                    'session': {
                        'id': 'disarmed-session',
                        'station': station,
                        'status': 'open',
                        'workflow_state': 'idle',
                        'opened_by': [],
                        'closed_by': [],
                    },
                }

        controller = SerialMotorController(
            device='/dev/serial/by-id/usb-TapTrack-test-controller',
        )
        self.service.verifier = SuccessfulWorkflowVerifier()
        self.service.motor_controller = controller
        self.service.motor_actuation_enabled = True

        status, payload = self.post_json('/cabinet/workflow', {
            'command': 'finish_open',
            'station': 'Station 1',
        })

        self.assertEqual(status, 200)
        self.assertEqual(payload['motor_dispatch']['outcome'], 'uncertain')
        self.assertFalse(payload['motor_dispatch']['serial_command_sent'])
        self.assertEqual(payload['motor_dispatch']['serial_connection'], 'disconnected')
        self.assertIn('recovery is required', payload['motor_dispatch']['error'])
        self.assertIsNone(controller._serial)

    def test_django_workflow_http_path_dispatches_v2_serial_actions_once(self):
        serial_port = FakeProtocolSerial()
        controller = SerialMotorController(serial_instance=serial_port, response_timeout=0.01)
        self.service.motor_controller = controller
        self.service.motor_actuation_enabled = True

        class SuccessfulWorkflowVerifier:
            def workflow(self, command=None, station=None):
                status = 'closed' if command == 'finish_close' else 'open'
                session_id = 'open-session' if command == 'finish_open' else 'close-session'
                return 200, {
                    'station': station,
                    'session': {
                        'id': session_id,
                        'station': station,
                        'status': status,
                        'workflow_state': 'idle',
                    },
                }

        self.service.verifier = SuccessfulWorkflowVerifier()
        self.assertTrue(self.service.recover_motor_controller(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))

        with self.assertLogs('nfc_service', level='INFO') as captured:
            open_status, open_payload = self.post_json('/cabinet/workflow', {
                'command': 'finish_open',
                'station': 'Station 1',
            })
            serial_port.command_response_mode = 'malformed'
            close_status, close_payload = self.post_json('/cabinet/workflow', {
                'command': 'finish_close',
                'station': 'Station 2',
            })
            duplicate_status, _ = self.post_json('/cabinet/workflow', {
                'command': 'finish_close',
                'station': 'Station 2',
            })

        commands = [
            frame.decode('ascii').rstrip('\n').split(',')
            for frame in serial_port.writes
            if frame.startswith(b'CMD,')
        ]
        self.assertEqual((open_status, close_status, duplicate_status), (200, 200, 200))
        self.assertEqual(open_payload['motor_dispatch']['outcome'], 'completed')
        self.assertTrue(open_payload['motor_dispatch']['serial_command_sent'])
        self.assertEqual(open_payload['motor_dispatch']['serial_command'], '1')
        self.assertEqual(open_payload['motor_dispatch']['transaction_id'], 1)
        self.assertEqual(
            [line.split(',')[4] for line in open_payload['motor_dispatch']['serial_responses']],
            ['ACCEPTED', 'BUSY', 'DONE'],
        )
        self.assertFalse(open_payload['motor_dispatch']['physical_movement_verified'])
        self.assertEqual(close_payload['motor_dispatch']['outcome'], 'uncertain')
        self.assertTrue(close_payload['motor_dispatch']['serial_command_sent'])
        self.assertFalse(close_payload['motor_dispatch']['physical_movement_verified'])
        self.assertEqual(commands, [
            ['CMD', '2', '0123456789abcdef', '1', '1'],
            ['CMD', '2', '0123456789abcdef', '2', '4'],
        ])
        action_states = {
            record['workflow_session']: record['status']
            for record in self.store.list_motor_actions()
        }
        self.assertEqual(action_states, {'open-session': 'COMPLETED', 'close-session': 'UNCERTAIN'})
        action_transmission = {
            record['workflow_session']: record['command_transmitted']
            for record in self.store.list_motor_actions()
        }
        self.assertEqual(action_transmission, {'open-session': 1, 'close-session': 1})
        self.assertTrue(any(
            'motor_action_result workflow_action=finish_open station=Station 1' in message
            and 'result=completed' in message
            for message in captured.output
        ))
        self.assertTrue(any(
            'motor_action_result workflow_action=finish_close station=Station 2' in message
            and 'reason=Unexpected frame while waiting for command response.' in message
            for message in captured.output
        ))
        self.assertTrue(any(
            'motor_action_reused workflow_action=finish_close station=Station 2' in message
            and 'state=UNCERTAIN' in message
            for message in captured.output
        ))

    def test_operator_recovery_is_refused_when_actuation_disabled_or_confirmation_missing(self):
        serial_port = FakeProtocolSerial()
        controller = SerialMotorController(serial_instance=serial_port, response_timeout=0.01)
        self.service.motor_controller = controller

        self.assertFalse(self.service.recover_motor_controller(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ))
        self.service.motor_actuation_enabled = True
        self.assertFalse(self.service.recover_motor_controller(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=False,
        ))
        self.assertEqual(serial_port.writes, [])

    def test_failed_django_final_transition_does_not_dispatch(self):
        class FailedWorkflowVerifier:
            def workflow(self, command=None, station=None):
                return 409, {'error': 'No opening workflow to finish.'}

        controller = FakeMotorController()
        self.service.verifier = FailedWorkflowVerifier()
        self.service.motor_controller = controller

        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.post_json('/cabinet/workflow', {
                'command': 'finish_open',
                'station': 'Station 1',
            })

        self.assertEqual(raised.exception.code, 409)
        raised.exception.close()
        self.assertEqual(controller.calls, [])

    def test_cabinet_workflow_rejects_unsupported_commands(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.post_json('/cabinet/workflow', {'command': 'override_status'})
        self.assertEqual(raised.exception.code, 400)
        raised.exception.close()

    def test_photo_capture_endpoint_requires_a_valid_django_event_id(self):
        class PhotoCapture:
            def __init__(self):
                self.event_ids = []

            def capture(self, event_id):
                self.event_ids.append(event_id)
                return True

        photo_capture = PhotoCapture()
        self.service.photo_capture = photo_capture

        status, captured = self.post_json('/photo/capture', {'event_id': 714})
        self.assertEqual(status, 200)
        self.assertEqual(captured, {'success': True, 'event_id': 714})
        self.assertEqual(photo_capture.event_ids, [714])

        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.post_json('/photo/capture', {'event_id': True})
        self.assertEqual(raised.exception.code, 400)
        raised.exception.close()
        self.assertEqual(photo_capture.event_ids, [714])

    def test_api_scans_returns_events_in_order_and_bounds_limit(self):
        for index in range(205):
            self.store.append({
                'uid': f'UID-{index}',
                'timestamp': f'2026-10-01T00:00:0{index}+00:00',
                'status': 'error',
                'error': 'test error',
                'http_status': 500,
                'django_response': {'success': False, 'error': 'test error'},
            })

        _, _, first = self.get_json('/api/scans?after=0&limit=2')
        _, _, second = self.get_json('/api/scans?after=200&limit=5000')

        self.assertEqual([event['event_id'] for event in first['events']], [1, 2])
        self.assertEqual(first['next_cursor'], 2)
        self.assertTrue(first['has_more'])
        self.assertEqual(len(second['events']), 5)
        self.assertEqual(second['events'][0]['event_id'], 201)
        self.assertEqual(second['events'][-1]['event_id'], 205)
        self.assertFalse(second['has_more'])

        _, _, bounded = self.get_json('/api/scans?after=0&limit=5000')
        self.assertEqual(len(bounded['events']), 200)
        self.assertTrue(bounded['has_more'])

    def test_api_scans_rejects_invalid_cursor_and_limit(self):
        for query in ('after=-1&limit=50', 'after=0&limit=0', 'after=x&limit=1'):
            with self.subTest(query=query):
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(self.url + '/api/scans?' + query)
                self.assertEqual(raised.exception.code, 400)
                raised.exception.close()

    def test_allowed_cors_origins_are_exact(self):
        for origin in ALLOWED_ORIGINS:
            with self.subTest(origin=origin):
                _, headers, _ = self.get_json('/api/scans?after=0&limit=50', origin=origin)
                self.assertEqual(headers.get('Access-Control-Allow-Origin'), origin)

        _, headers, _ = self.get_json('/api/scans?after=0&limit=50', origin='http://evil.example')
        self.assertIsNone(headers.get('Access-Control-Allow-Origin'))

    def test_bridge_rejects_non_loopback_bind(self):
        with self.assertRaises(ValueError):
            create_http_server(self.store, self.service, host='0.0.0.0', port=0)


if __name__ == '__main__':
    unittest.main()