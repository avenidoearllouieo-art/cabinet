# TapTrack Raspberry Pi Password-Reset Service

This service is the device-side bridge for the password-recovery flow. It is separate from the React cabinet prototype and should run on the Raspberry Pi.

## Security boundary

- The service binds to `127.0.0.1` only by default.
- The browser sends only a short-lived Django `request_id` to the local service.
- The service claims that request from Django using `DEVICE_API_KEY`.
- The service calls the protected NFC verification endpoint using `DEVICE_API_KEY`.
- The API key stays in the Pi process environment and is never sent to or bundled with React.
- The returned reset token is delivered only to the configured cabinet display callback. It is never returned by the local handoff endpoint and is never logged.

## Configuration

```powershell
$env:TAPTRACK_API_BASE_URL = 'http://127.0.0.1:8000/api'
$env:DEVICE_API_KEY = 'set-this-only-on-the-pi'
$env:TAPTRACK_PI_BIND_HOST = '127.0.0.1'
$env:TAPTRACK_PI_PORT = '8765'
```

The production NFC adapter must implement `NFCScanner.scan_uid()`. Until the reader is connected, use the explicit mock adapter in development only:

```powershell
$env:TAPTRACK_NFC_MODE = 'mock'
$env:TAPTRACK_MOCK_NFC_UID = 'a-registered-demo-uid'
python password_reset_service.py
```

## Browser handoff

The future Password Recovery web screen can POST to the local service:

```http
POST http://127.0.0.1:8765/password-reset/handoff
Content-Type: application/json

{"request_id":"..."}
```

The response contains only the handoff status and expiration. The service then waits for the NFC adapter, calls Django, and displays the returned one-time code locally on the cabinet. The code is entered manually on the web recovery page.

In mock mode, the Cabinet React prototype uses these loopback-only endpoints:

```http
GET  /password-reset/display
POST /password-reset/mock-scan
POST /password-reset/retry
POST /password-reset/clear
POST /cabinet/mock-access
POST /cabinet/mock-capture
POST /cabinet/register
GET  /cabinet/scan
POST /cabinet/verify
GET  /status
```

`/cabinet/mock-access` delegates the configured mock UID to Django's existing `/verify-nfc/` endpoint. `/cabinet/register` delegates account creation to Django's device-authenticated registration endpoint. `/status` explicitly reports mock mode and disconnected physical hardware.

For the NFC enrollment flow, the Cabinet waits on `GET /cabinet/scan`, then sends the returned UID to `POST /cabinet/verify`. In mock mode, simulate the waiting scanner with:

```http
POST /password-reset/mock-scan
Content-Type: application/json

{"uid":"an-unregistered-test-uid"}
```

The Pi bridge forwards Django's temporary registration response to the Cabinet. The QR contains only the registration URL and temporary token; the NFC UID remains outside the URL.

The display endpoint is only for the local mock cabinet display. It is not a Django endpoint and it never contains the Pi API key. Production hardware adapters remain intentionally unimplemented until the reader and display are available.

The service does not implement password reset or duplicate Django validation logic. Django remains the security authority.

## Cabinet NFC reader service

`nfc_service.py` is the hardware-neutral service for the Cabinet access flow. It uses only Python's standard library and never calls Django, reads the database, or receives the Django API key.

The Cabinet selects its source with:

```env
VITE_NFC_MODE=mock
VITE_NFC_SERVICE_URL=http://127.0.0.1:5000
VITE_NFC_COOLDOWN_MS=2500
```

Use `VITE_NFC_MODE=mock` on a development computer to keep the Mock NFC UID field. Use `VITE_NFC_MODE=hardware` on the Pi; the Cabinet then polls the local service automatically and hides the manual mock input.

Run its development mock mode:

```bash
cd pi_service
python -m unittest test_nfc_service.py
```

Install Python 3.11 or newer. The service currently has no third-party dependencies:

```bash
cd pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Run the HTTP service with mock input:

```powershell
$env:TAPTRACK_NFC_MODE = 'mock'
$env:TAPTRACK_NFC_PORT = '5000'
python nfc_service.py
```

Endpoints:

```http
GET  http://127.0.0.1:5000/nfc/status
POST http://127.0.0.1:5000/nfc/mock-scan
POST http://127.0.0.1:5000/nfc/mock-remove
```

The scan body is `{"uid":"TEST-NFC-001"}`. The service reports one `event_id` per card insertion and holds the card in `detected` state until `/nfc/mock-remove` is called. The Cabinet polls `/nfc/status` using `VITE_NFC_SERVICE_URL`, consumes each event once, and sends the UID through its existing Django verification function.

No exact reader model or Python hardware library is identified in this repository. The production portion requires an adapter implementing `NFCReader.wait_for_card()` and `wait_for_removal()` in `reader_adapters.py`, using the teammate's confirmed reader library. The UI and Django layers do not need to change for that adapter.

For hardware mode on the Pi:

```bash
export TAPTRACK_NFC_MODE=hardware
export TAPTRACK_NFC_BIND_HOST=127.0.0.1
export TAPTRACK_NFC_PORT=5000
python3 nfc_service.py
```

The current hardware mode reports a clear unavailable-reader error until that adapter is implemented. Do not install or select a reader library until the exact reader model and connection method are confirmed.
