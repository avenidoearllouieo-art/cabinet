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
GET  /status
```

`/cabinet/mock-access` delegates the configured mock UID to Django's existing `/verify-nfc/` endpoint. `/cabinet/register` delegates account creation to Django's device-authenticated registration endpoint. `/status` explicitly reports mock mode and disconnected physical hardware.

The display endpoint is only for the local mock cabinet display. It is not a Django endpoint and it never contains the Pi API key. Production hardware adapters remain intentionally unimplemented until the reader and display are available.

The service does not implement password reset or duplicate Django validation logic. Django remains the security authority.
