"""Loopback integration test of the checked-in ingress using real Nginx and fake serial."""

import argparse
import base64
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch


DEPLOY = Path(__file__).resolve().parent
sys.path.insert(0, str(DEPLOY.parents[1] / 'pi_service'))

import nfc_service
import test_nfc_service as fixtures
from workflow_timing import INGRESS_AGE_HEADER, INGRESS_FORWARDED_AT_HEADER, WORKFLOW_EXPIRED_CODE


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


class ProxyTests(unittest.TestCase):
    nginx = None
    openssl = None

    def setUp(self):
        if not self.nginx or not self.openssl:
            self.skipTest('Run this script with --nginx and --openssl to test a real proxy')
        scratch = tempfile.TemporaryDirectory(prefix='taptrack-proxy-test-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.seen = []
        self.queue_delay = 0
        self.https_port, self.http_port = free_port(), free_port()
        while self.http_port == self.https_port:
            self.http_port = free_port()
        self.origin = f'https://127.0.0.1:{self.https_port}'

        class ObserveHandler(nfc_service.NFCHandler):
            def do_POST(handler):
                self.seen.append(handler.headers)
                if self.queue_delay:
                    time.sleep(self.queue_delay)
                super().do_POST()

        self.rig = fixtures.NFCBridgeHTTPTests('test_cabinet_workflow_get_and_post_proxy_to_django')
        with patch.object(nfc_service, 'NFCHandler', ObserveHandler):
            self.rig.setUp()
        self.addCleanup(self.rig.tearDown)
        self.serial = fixtures.FakeSerial()
        self.rig._fake_workflow_on_serial(self.serial)
        origins = patch.object(nfc_service, 'ALLOWED_ORIGINS', {self.origin})
        origins.start()
        self.addCleanup(origins.stop)

        (self.root / 'logs').mkdir()
        (self.root / 'temp').mkdir()
        cert, key = self.root / 'cert.pem', self.root / 'key.pem'
        subprocess.run([self.openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True, timeout=15)
        self.context = ssl.create_default_context(cafile=str(cert))
        password = secrets.token_hex(12)
        hashed = subprocess.check_output([self.openssl, 'passwd', '-apr1', '-stdin'],
                                         input=password.encode('ascii') + b'\n', timeout=10).strip()
        password_file = self.root / 'kiosk.htpasswd'
        password_file.write_bytes(b'fixture:' + hashed + b'\n')
        self.auth = 'Basic ' + base64.b64encode(f'fixture:{password}'.encode()).decode()
        token_file = self.root / 'workflow-header.conf'
        token_file.write_text(f'proxy_set_header {nfc_service.WORKFLOW_PROXY_HEADER} {fixtures.TEST_WORKFLOW_PROXY_TOKEN};\n',
                              encoding='ascii')

        port = self.rig.server.server_address[1]
        route = (DEPLOY / 'nginx-workflow-ingress.conf').read_text()
        route = route.replace(':5001/', f':{port}/')
        access = (DEPLOY / 'nginx-kiosk-access.conf').read_text()
        access = access.replace('/etc/taptrack/nginx/kiosk.htpasswd', f'"{password_file.as_posix()}"')
        (self.root / 'kiosk-access.conf').write_text(access)
        site = self.root / 'site'
        site.mkdir()
        (site / 'index.html').write_text('Cabinet fixture')
        route = route.replace('/etc/taptrack/nginx/kiosk-access.conf', 'kiosk-access.conf')
        route = route.replace('/etc/taptrack/nginx/workflow-proxy-header.conf', f'"{token_file.as_posix()}"')
        (self.root / 'workflow.conf').write_text(route)
        template = (DEPLOY / 'nginx.conf').read_text()
        location = 'location ^~ /nfc-bridge/ {'
        generic_body = template.split(location, 1)[1].split('\n        }', 1)[0]
        generic = (location + generic_body + '\n}').replace(':5001/', f':{port}/')
        config = self.root / 'nginx.conf'
        config.write_text(f'''
daemon off;
master_process off;
error_log logs/error.log;
pid logs/nginx.pid;
events {{ worker_connections 32; }}
http {{
    access_log off;
    client_body_temp_path temp/body;
    proxy_temp_path temp/proxy;
    fastcgi_temp_path temp/fastcgi;
    uwsgi_temp_path temp/uwsgi;
    scgi_temp_path temp/scgi;
    ssl_certificate "{cert.as_posix()}";
    ssl_certificate_key "{key.as_posix()}";
    server {{
        listen 127.0.0.1:{self.https_port} ssl default_server;
        server_name _;
        return 403;
    }}
    server {{
        listen 127.0.0.1:{self.https_port} ssl;
        server_name 127.0.0.1;
        location / {{
            include kiosk-access.conf;
            root "{site.as_posix()}";
        }}
        include workflow.conf;
        {generic}
    }}
    server {{
        listen 127.0.0.1:{self.http_port};
        include workflow.conf;
        {generic}
    }}
}}
''')
        command = [self.nginx, '-p', self.root.as_posix() + '/', '-c', str(config)]
        check = subprocess.run([*command, '-t'], capture_output=True, timeout=10)
        self.assertEqual(check.returncode, 0, check.stderr.decode(errors='replace'))
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, creationflags=flags)
        self.addCleanup(self.stop_nginx)
        until = time.monotonic() + 10
        while True:
            self.assertIsNone(self.process.poll(), 'Temporary Nginx exited')
            try:
                with socket.create_connection(('127.0.0.1', self.https_port), timeout=0.2):
                    break
            except OSError:
                if time.monotonic() >= until:
                    self.fail('Temporary Nginx did not start')
                time.sleep(0.05)

    def stop_nginx(self):
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)

    def post(self, path='/nfc-bridge/cabinet/workflow', *, auth=True, tls=True, extra=None, buffer_for=0, local=False):
        body = json.dumps({'command': 'finish_open', 'station': 'Station 1'}).encode()
        headers = {'Origin': self.origin, 'Content-Type': 'application/json', 'Content-Length': str(len(body))}
        if auth:
            headers['Authorization'] = self.auth
        headers.update(extra or {})
        source_address = ('127.0.0.1' if local else '127.0.0.2', 0)
        if tls:
            client = http.client.HTTPSConnection('127.0.0.1', self.https_port, context=self.context, timeout=22,
                                                 source_address=source_address)
        else:
            client = http.client.HTTPConnection('127.0.0.1', self.http_port, timeout=5,
                                                source_address=source_address)
        try:
            client.putrequest('POST', path, skip_host='Host' in headers)
            for name, value in headers.items():
                client.putheader(name, value)
            client.endheaders()
            if buffer_for:
                client.send(body[:1])
                time.sleep(buffer_for)
                body = body[1:]
            client.send(body)
            response = client.getresponse()
            return response.status, response.read()
        finally:
            client.close()

    def command_count(self):
        return sum(frame.startswith(b'CMD,') for frame in self.serial.writes)

    def test_fresh_authenticated_request_overwrites_spoofed_headers_and_dispatches_once(self):
        spoofed = {
            nfc_service.WORKFLOW_PROXY_HEADER: 'untrusted',
            INGRESS_AGE_HEADER: '99.000',
            INGRESS_FORWARDED_AT_HEADER: '0.000',
        }
        with self.rig.service.motor_controller._lock:
            self.assertTrue(self.rig.service.motor_controller._connect_locked())
        status, raw = self.post(extra=spoofed)
        if status != 200:
            log = (self.root / 'logs' / 'error.log').read_text(errors='replace')
            self.fail(f'Fresh request returned HTTP {status}. Temporary Nginx log: {log}')
        self.assertIs(json.loads(raw)['motor_dispatch']['serial_command_sent'], True)
        self.assertNotIn('Authorization', self.seen[-1])
        for name, value in spoofed.items():
            self.assertEqual(len(self.seen[-1].get_all(name)), 1)
            self.assertNotEqual(self.seen[-1][name], value)
        status, body = self.post()
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['motor_dispatch']['dispatch_skipped'])
        self.assertEqual(self.command_count(), 1)

    def test_kiosk_page_at_cold_start_is_available_without_a_basic_prompt(self):
        for peer, expected in (('127.0.0.1', 200), ('127.0.0.2', 401)):
            with self.subTest(peer=peer):
                client = http.client.HTTPSConnection(
                    '127.0.0.1', self.https_port, context=self.context,
                    source_address=(peer, 0), timeout=5,
                )
                try:
                    client.request('GET', '/')
                    response = client.getresponse()
                    self.assertEqual(response.status, expected)
                    self.assertEqual('WWW-Authenticate' in response.headers, expected == 401)
                finally:
                    client.close()
        self.assertEqual(self.command_count(), 0)

    def test_loopback_kiosk_needs_no_basic_prompt_but_keeps_trusted_origin(self):
        self.assertEqual(self.post(auth=False, local=True, extra={'Origin': 'https://untrusted.invalid'})[0], 403)
        self.assertEqual(self.command_count(), 0)
        status, body = self.post(auth=False, local=True)
        self.assertEqual(status, 200, body)
        self.assertIs(json.loads(body)['motor_dispatch']['serial_command_sent'], True)
        self.assertEqual(self.command_count(), 1)

    def test_unauthorized_alternate_routes_never_inject_trusted_headers(self):
        spoofed = {nfc_service.WORKFLOW_PROXY_HEADER: fixtures.TEST_WORKFLOW_PROXY_TOKEN,
                   INGRESS_AGE_HEADER: '0.000', INGRESS_FORWARDED_AT_HEADER: f'{time.time():.3f}'}
        self.assertEqual(self.post(auth=False, extra=spoofed)[0], 401)
        self.assertEqual(self.post(path='/nfc-bridge//cabinet/workflow', auth=False)[0], 401)
        self.assertEqual(self.post(tls=False, extra=spoofed)[0], 403)
        self.assertEqual(self.post(extra={'Host': 'wrong.invalid'})[0], 403)
        self.assertEqual(self.seen, [])
        self.assertEqual(self.post(extra={'Origin': 'https://untrusted.invalid'})[0], 403)
        self.assertEqual(self.post(path='/nfc-bridge/cabinet/workflow/', extra=spoofed)[0], 404)
        for header in spoofed:
            self.assertNotIn(header, self.seen[-1])
        self.assertEqual(self.command_count(), 0)

    def test_real_proxy_counts_body_buffering_and_later_upstream_queue(self):
        self.queue_delay = 3.0
        with patch.object(self.rig.service.verifier, 'workflow') as workflow:
            status, raw = self.post(buffer_for=7.5)
            workflow.assert_not_called()
        self.assertGreaterEqual(float(self.seen[-1][INGRESS_AGE_HEADER]), 7.0)
        self.assertEqual(status, 408, raw)
        self.assertEqual(json.loads(raw)['code'], WORKFLOW_EXPIRED_CODE)
        self.assertEqual(self.rig.store.list_motor_actions(), [])
        self.assertEqual(self.command_count(), 0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nginx', type=Path, required=True)
    parser.add_argument('--openssl', type=Path, required=True)
    args = parser.parse_args()
    ProxyTests.nginx = str(args.nginx.resolve(strict=True))
    ProxyTests.openssl = str(args.openssl.resolve(strict=True))
    def forbid_serial(*args, **kwargs):
        raise AssertionError('Real serial is prohibited during proxy tests')
    with patch.dict(sys.modules, {'serial': SimpleNamespace(Serial=forbid_serial)}):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ProxyTests))
    raise SystemExit(not result.wasSuccessful())
