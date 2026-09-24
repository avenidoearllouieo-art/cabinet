"""Hardware-reader boundary for the TapTrack NFC service.

The repository does not identify a physical reader model or library. Keep the
model-specific implementation in this module once the Raspberry Pi hardware
is confirmed; the HTTP service and Cabinet UI do not need to change.
"""

from __future__ import annotations

from typing import Protocol


class ReaderUnavailable(RuntimeError):
    pass


class NFCReader(Protocol):
    def wait_for_card(self) -> str:
        """Block until a card is present and return its UID."""

    def wait_for_removal(self) -> None:
        """Block until the current card is removed."""


class UnavailableNFCReader:
    def wait_for_card(self) -> str:
        raise ReaderUnavailable(
            'No hardware NFC adapter is configured. Confirm the reader model and install its library.'
        )

    def wait_for_removal(self) -> None:
        return None
