"""Hardware-reader adapter for the TapTrack USB NFC keyboard-wedge reader."""

from __future__ import annotations

import time
from typing import Any


class ReaderUnavailable(RuntimeError):
    """Raised when the physical USB reader cannot be found or read."""


def normalize_uid(uid: str) -> str:
    return ''.join(str(uid).strip().split()).upper()


def build_key_map(ecodes: Any) -> dict[int, str]:
    key_map = {getattr(ecodes, f'KEY_{digit}'): digit for digit in '0123456789'}
    key_map.update({getattr(ecodes, f'KEY_{letter}'): letter for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'})
    return key_map


class UIDKeyParser:
    """Collect keyboard-emulated UID characters until Enter terminates a scan."""

    def __init__(self, ecodes: Any, key_map: dict[int, str] | None = None, reset_after: float = 0.5):
        self.ecodes = ecodes
        self.key_map = key_map or build_key_map(ecodes)
        self.reset_after = reset_after
        self.buffer = ''
        self.last_key_time = 0.0

    def feed(self, event: Any, now: float | None = None) -> str | None:
        if event.type != self.ecodes.EV_KEY or event.value != 1:
            return None

        current_time = time.monotonic() if now is None else now
        if current_time - self.last_key_time > self.reset_after and self.buffer:
            self.buffer = ''
        self.last_key_time = current_time

        if event.code == self.ecodes.KEY_ENTER:
            uid = normalize_uid(self.buffer)
            self.buffer = ''
            return uid or None

        character = self.key_map.get(event.code)
        if character:
            self.buffer += character
        return None


class EvdevNFCReader:
    """Read UID keystrokes from a USB reader whose device name contains IC Reader."""

    def __init__(self, evdev_module: Any | None = None, reader_name: str = 'IC Reader'):
        self._evdev = evdev_module
        self.reader_name = reader_name
        self._device = None
        self._parser = None

    def _load_evdev(self):
        if self._evdev is None:
            try:
                import evdev
            except ImportError as error:
                raise ReaderUnavailable('python-evdev is not installed.') from error
            self._evdev = evdev
        return self._evdev

    def find_reader(self):
        evdev = self._load_evdev()
        for path in evdev.list_devices():
            try:
                device = evdev.InputDevice(path)
                if self.reader_name in device.name:
                    return device
                device.close()
            except Exception:
                continue
        return None

    def wait_for_card(self) -> str:
        evdev = self._load_evdev()
        if self._device is None:
            self._device = self.find_reader()
            if self._device is None:
                raise ReaderUnavailable('IC Reader was not found.')
            self._parser = UIDKeyParser(evdev.ecodes)

        try:
            for event in self._device.read_loop():
                uid = self._parser.feed(event)
                if uid:
                    return uid
        except Exception as error:
            self.close()
            raise ReaderUnavailable(f'IC Reader disconnected or failed: {error}') from error

        self.close()
        raise ReaderUnavailable('IC Reader stopped sending events.')

    def wait_for_removal(self) -> None:
        return None

    def close(self) -> None:
        if self._device is not None:
            try:
                self._device.close()
            except Exception:
                pass
        self._device = None
        self._parser = None


class UnavailableNFCReader:
    """Reader placeholder retained for explicit no-hardware/test environments."""

    def wait_for_card(self) -> str:
        raise ReaderUnavailable('No hardware NFC adapter is configured.')

    def wait_for_removal(self) -> None:
        return None