import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from nfc_service import (
    ALLOWED_ORIGINS,
    BRIDGE_HOST,
    BRIDGE_PORT,
    DjangoRequestError,
    DjangoVerifier,
    MockNFCReader,
    NFCService,
    SQLiteScanEventStore,
    create_http_server,
    make_scan_event,
    normalize_uid,
)
from reader_adapters import EvdevNFCReader, ReaderUnavailable, UIDKeyParser, build_key_map


class FakeVerifier:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def verify(self, uid):
        self.calls.append(uid)
        if self.error:
            raise self.error
        return self.result


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._body = json.dumps(payload).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


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


class NFCBridgeHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = SQLiteScanEventStore(Path(self.temp_dir.name) / 'http-events.sqlite3')
        self.service = NFCService(MockNFCReader(), self.store, FakeVerifier((200, {})))
        self.server = create_http_server(self.store, self.service, host='127.0.0.1', port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def get_json(self, path, origin=None):
        headers = {'Origin': origin} if origin else {}
        with urllib.request.urlopen(urllib.request.Request(self.url + path, headers=headers)) as response:
            return response.status, response.headers, json.loads(response.read().decode('utf-8'))

    def post_json(self, path, payload):
        request = urllib.request.Request(
            self.url + path,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode('utf-8'))

    def test_bridge_binds_to_loopback_default_and_has_expected_port(self):
        self.assertEqual(BRIDGE_HOST, '127.0.0.1')
        self.assertEqual(BRIDGE_PORT, 5001)
        self.assertEqual(self.server.server_address[0], '127.0.0.1')

    def test_api_scans_empty_result_preserves_cursor(self):
        status, _, body = self.get_json('/api/scans?after=19&limit=50')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'events': [], 'next_cursor': 19, 'has_more': False})

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

    def test_cabinet_workflow_rejects_unsupported_commands(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.post_json('/cabinet/workflow', {'command': 'override_status'})
        self.assertEqual(raised.exception.code, 400)
        raised.exception.close()

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