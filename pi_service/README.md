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

## Cabinet scan-result service

Production flow:

```text
IC Reader IC Reader USB keyboard-wedge
	-> EvdevNFCReader (key-down events through Enter)
	-> one POST http://127.0.0.1:8000/api/verify-nfc/ per completed UID
	-> persistent SQLite result event
	-> GET http://127.0.0.1:5001/api/scans?after=<event_id>&limit=50
	-> Cabinet browser
```

`reader_adapters.py` detects an evdev device whose name contains `IC Reader`, maps digit/letter key-down events, terminates each UID on Enter, resets partial input after a 0.5-second key gap, and applies the original whitespace-removing uppercase UID normalization. Hardware mode is the default. `python-evdev` is the only additional Pi-service dependency.

The NFC service sends the Django request server-side using `DEVICE_API_KEY` (or `TAPTRACK_DEVICE_API_KEY`) from its process environment. It stores no key in SQLite and exposes no key to the browser. A completed registered response becomes a `registered` event; Django's 404 enrollment response becomes `unregistered`; network, HTTP, and malformed-result failures become `error`. One parsed Enter-terminated UID invokes one verifier call and one SQLite insert. Bridge polling is read-only and never creates another Django request.

The SQLite database defaults to `pi_service/nfc_events.sqlite3`; override it with `TAPTRACK_NFC_DB_PATH`. The bridge binds only to `127.0.0.1:5001`, permits CORS only from `http://127.0.0.1:4000` and `http://localhost:4000`, returns events in ascending `event_id` order, and never deletes events on GET.

### Hardware setup

```bash
cd ~/tap-track/pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Ensure the systemd user can read `/dev/input/event*` devices. On Raspberry Pi OS this commonly means adding the service user to the `input` group and starting a new login session.

Set `DEVICE_API_KEY` in `/etc/taptrack/nfc.env` with restrictive permissions. Do not place it in any `VITE_` variable or Cabinet build config.

### Development mock mode

The mock reader remains available for local tests without replacing the real hardware reader:

```bash
cd ~/tap-track/pi_service
TAPTRACK_NFC_MODE=mock python3 nfc_service.py
```

The same loopback server exposes `POST /nfc/mock-scan` with `{"uid":"TEST-NFC-001"}` and `POST /nfc/mock-remove`. These mock endpoints are disabled when the real evdev reader is active. `GET /nfc/status` is diagnostic only; the official Cabinet consumes scan results from `/api/scans`.

Run Pi-service tests with:

```bash
cd ~/tap-track/pi_service
python3 -m unittest discover -s . -p 'test_*.py'
```
