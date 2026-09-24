"""Local NFC reader service for the TapTrack Cabinet UI.

This process owns only reader communication. It never calls Django and never
stores student or API-key data. A hardware adapter can later implement the
NFCReader protocol when the exact Raspberry Pi reader is confirmed.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from reader_adapters import NFCReader, ReaderUnavailable, UnavailableNFCReader


def normalize_uid(uid: str) -> str:
    return ''.join(str(uid).strip().split()).upper()


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


class NFCServiceState:
    def __init__(self, reader_connected: bool) -> None:
        self.reader_connected = reader_connected
        self.state = 'waiting' if reader_connected else 'error'
        self.uid: str | None = None
        self.event_id = 0
        self.error = None if reader_connected else 'No NFC reader adapter is configured.'
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

    def card_detected(self, uid: str) -> None:
        with self._lock:
            self.uid = uid
            self.state = 'detected'
            self.error = None
            self.event_id += 1

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
    def __init__(self, reader: NFCReader, reader_connected: bool) -> None:
        self.reader = reader
        self.state = NFCServiceState(reader_connected)

    def run(self) -> None:
        while True:
            try:
                uid = normalize_uid(self.reader.wait_for_card())
                if not uid:
                    continue
                self.state.card_detected(uid)
                self.reader.wait_for_removal()
                self.state.card_removed()
            except ReaderUnavailable as error:
                self.state.reader_error(str(error))
                time.sleep(2)
            except Exception as error:
                self.state.reader_error(f'NFC reader error: {error}')
                time.sleep(2)


class NFCHandler(BaseHTTPRequestHandler):
    service: NFCService | None = None

    def _allowed_origins(self) -> set[str]:
        configured = os.environ.get('TAPTRACK_NFC_WEB_ORIGINS', '')
        return {item.strip() for item in configured.split(',') if item.strip()} or {
            'http://localhost:5173',
            'http://127.0.0.1:5173',
        }

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

    def do_GET(self) -> None:
        if self.path != '/nfc/status' or self.service is None:
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return
        self._send_json(HTTPStatus.OK, self.service.state.snapshot())

    def do_POST(self) -> None:
        if self.service is None or self.path not in ('/nfc/mock-scan', '/nfc/mock-remove'):
            self._send_json(HTTPStatus.NOT_FOUND, {'error': 'Not found.'})
            return
        if not isinstance(self.service.reader, MockNFCReader):
            self._send_json(HTTPStatus.NOT_IMPLEMENTED, {'error': 'Mock NFC input is disabled.'})
            return
        try:
            if self.path == '/nfc/mock-remove':
                self.service.reader.simulate_removal()
                self._send_json(HTTPStatus.OK, {'accepted': True})
                return
            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
            self.service.reader.simulate_scan(str(payload.get('uid', '')))
            self._send_json(HTTPStatus.OK, {'accepted': True})
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {'error': str(error)})

    def log_message(self, format: str, *args) -> None:
        return None


def build_reader() -> tuple[NFCReader, bool]:
    if os.environ.get('TAPTRACK_NFC_MODE', '').strip().lower() == 'mock':
        return MockNFCReader(), True
    return UnavailableNFCReader(), False


def main() -> None:
    reader, connected = build_reader()
    service = NFCService(reader, connected)
    NFCHandler.service = service
    threading.Thread(target=service.run, daemon=True).start()
    host = os.environ.get('TAPTRACK_NFC_BIND_HOST', '127.0.0.1')
    port = int(os.environ.get('TAPTRACK_NFC_PORT', '5000'))
    print(f'TapTrack NFC service listening on {host}:{port}')
    ThreadingHTTPServer((host, port), NFCHandler).serve_forever()


if __name__ == '__main__':
    main()