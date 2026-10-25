# TapTrack Raspberry Pi deployment

## Overview

This repository runs the official Cabinet touchscreen UI and Pi-local NFC reader/scan bridge.

The target boot order is:

1. OS boots
2. Python NFC service starts
3. Cabinet UI starts
4. Chromium opens the Cabinet in kiosk mode
5. Students see the TapTrack Cabinet home screen and tap their NFC card

## Required OS and runtime

- Raspberry Pi OS (64-bit recommended)
- Raspberry Pi with touchscreen/LCD connected
- Network access to the Django server
- Node.js 22.x recommended
- Python 3.11+
- Chromium browser

## Required packages

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv python3-pip chromium x11-xserver-utils
```

If needed, install Node.js 22 with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22.12.0
nvm alias default 22.12.0
```

## Repository setup

The confirmed live NFC-service checkout is `/home/taptrack/tap-track`. Verify the active unit before changing it:

```bash
sudo systemctl cat taptrack-nfc.service
sudo systemctl show taptrack-nfc.service -p User -p WorkingDirectory -p ExecStart
cd /home/taptrack/tap-track
git status --short
```

Before updating, confirm the service unit's `WorkingDirectory` and `ExecStart` match this checkout and the Git branch/remotes are the expected deployment source. Do not overwrite `/etc/taptrack/nfc.env` or SQLite files. After the reviewed change is available on the Pi:

```bash
cd /home/taptrack/tap-track
git status --short
git branch --show-current
git remote -v
git pull --ff-only
```

Only restart the NFC service for Pi-service changes. If deploying the updated unit file, first inspect the diff and then install it and reload systemd:

```bash
sudo cp /home/taptrack/tap-track/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/taptrack-nfc.service
sudo systemctl daemon-reload
sudo systemctl restart taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
curl -fsS http://127.0.0.1:5001/nfc/status
```

This is a deployment procedure only; these commands were not run as part of this task. Do not run any motor recovery or change the safe environment defaults until the physical safety checklist is complete.

## Install Python dependencies

```bash
cd /home/taptrack/tap-track/pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Install Cabinet dependencies

```bash
cd /home/taptrack/tap-track/cabinet
npm install
```

## Required environment variables

Set Cabinet browser build-time values in `cabinet/.env.production` before building:

```env
VITE_NFC_BRIDGE_URL=/nfc-bridge/api/scans
VITE_DJANGO_API_BASE_URL=/api
VITE_DJANGO_SERVER_URL=http://127.0.0.1:8000
```

The Cabinet browser calls same-origin `/nfc-bridge/*` and `/api/*` paths. Its Vite preview server proxies those paths to the Pi-local NFC bridge on `127.0.0.1:5001` and Django on `127.0.0.1:8000`. If Django is hosted elsewhere, set the Cabinet's API base and server-side proxy target to that exact reachable deployment before building. Do not use browser `127.0.0.1` URLs for a service on another machine, and never put API credentials in `VITE_` variables or URLs.

Set `TAPTRACK_NFC_ALLOWED_ORIGINS` in `/etc/taptrack/nfc.env` to a comma-separated list of exact browser origins for the Cabinet. For the requested UI URL, use `http://localhost:4000`; add `http://127.0.0.1:4000` or another production origin only if users intentionally open Cabinet at that exact origin. Origins must be HTTP(S) scheme + host + optional port only. Paths, wildcards, `null`, and arbitrary forwarded headers are not accepted. Handoff/cancel POSTs and bridge-status GETs with an Origin require an exact allowlist match. A missing Origin is accepted only for the read-only bridge-status GET because browsers may omit Origin on same-origin GET requests; CORS headers are still emitted only for an exact allowed Origin. The service does not derive trust from `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto`.

### Recovery-origin fix deployment and rollback

Changed files for this fix:

- `cabinet/vite.config.js`
- `cabinet/src/services/viteProxy.test.js`
- `pi_service/nfc_service.py`
- `pi_service/test_nfc_service.py`
- `pi_service/deploy/nfc.env.example`
- `pi_service/deploy/README.md`

The same-origin Cabinet bridge URL and preview proxy were already present in this checkout; the current patch makes the Origin header behavior explicit and adds the configurable Pi allowlist.

Before deploying, inspect `systemctl cat taptrack-nfc.service`, its effective paths, the Cabinet process/port, and the worktree. Cabinet may run as a Vite process rather than a systemd unit; do not restart a nonexistent Cabinet unit. Back up the NFC script and active environment file without printing environment contents. Set the exact Cabinet origin in the environment file loaded by the active NFC unit, preserve restrictive permissions, then restart only `taptrack-nfc.service` after confirming no recovery handoff is active and no motor command is in progress:

```bash
cp -p /home/taptrack/tap-track-clean/pi_service/nfc_service.py /home/taptrack/tap-track-clean/pi_service/nfc_service.py.before-origin-fix
cp -p /home/taptrack/tap-track/pi_service/nfc-service.env /home/taptrack/tap-track/pi_service/nfc-service.env.before-origin-fix
sudoedit /home/taptrack/tap-track/pi_service/nfc-service.env
python -m py_compile /home/taptrack/tap-track-clean/pi_service/nfc_service.py
sudo systemctl restart taptrack-nfc.service
systemctl is-active taptrack-nfc.service
systemctl show taptrack-nfc.service -p WorkingDirectory -p ExecStart -p EnvironmentFiles --no-pager
sudo journalctl -u taptrack-nfc.service -n 50 --no-pager
curl --fail --silent http://127.0.0.1:5001/nfc/status
```

Verify from the Cabinet browser that handoff uses `/nfc-bridge/password-reset/handoff`, a fresh Portal-created request is accepted, and an unlisted Origin is rejected. Never log request IDs. Do not run a motor command as part of deployment. To roll back, restore the environment backup, move the failed build aside, restore the previous build, and restart only these affected services:

```bash
cp -p /home/taptrack/tap-track-clean/pi_service/nfc_service.py.before-origin-fix /home/taptrack/tap-track-clean/pi_service/nfc_service.py
cp -p /home/taptrack/tap-track/pi_service/nfc-service.env.before-origin-fix /home/taptrack/tap-track/pi_service/nfc-service.env
sudo systemctl restart taptrack-nfc.service
```

Do not reset or overwrite unrelated worktree changes.

Important:

- VITE values are compiled into the browser bundle. Never put `DEVICE_API_KEY` or a Django API key in VITE variables.
- Django's `TAPTRACK_NFC_REGISTRATION_URL_BASE` setting controls the registration URL in new QR codes. Configure it in `backend/.env`; the Cabinet forwards that URL unchanged.

Put `DEVICE_API_KEY` only in `/etc/taptrack/nfc.env`, loaded only by the NFC systemd service. Set that file to mode `0600`. Never pass it to the Cabinet preview process or place it in a `VITE_` variable.

Password-reset request creation runs through the Portal's Django API, while the Cabinet sends its handoff through the Pi. Both must reach the same Django deployment and database. If Django is not hosted on the Pi, set `TAPTRACK_DJANGO_API_BASE_URL` in `/etc/taptrack/nfc.env` to the exact reachable Django API base used by the Portal (the `/api` base, without a trailing slash). Do not use `127.0.0.1` on the Pi unless Django actually runs on that Pi. When this setting is present it is authoritative for Pi-side NFC verification, cabinet workflows, password-reset handoff, and NFC verification; legacy `TAPTRACK_DJANGO_VERIFY_URL` and `TAPTRACK_DJANGO_WORKFLOW_URL` are used only when the shared base is unset. Never include an API key in the URL.

The handoff endpoint is `POST /api/auth/password-reset/cabinet-handoff/` and looks up the opaque `request_id` created by `POST /api/auth/password-reset/request/`. A generic unavailable response can mean the ID is unknown to the configured Django database or was created for account details that did not match; it intentionally does not reveal which. A Django `Not found.` route response is reported separately as a missing endpoint/configuration problem. Verify the Portal and Pi API targets before retrying with a newly created request ID.

The motor integration has two explicit server-side modes: `mock` and `serial`. The deployment template selects the real `serial` controller using the previously confirmed stable device path, but keeps `TAPTRACK_MOTOR_ACTUATION_ENABLED=false`; the Cabinet UI has no motor-mode selector. While disabled, the service creates one controller but does not open the serial port or send any command. Missing or unknown mode configuration fails startup instead of selecting a fallback.

To configure the serial controller without enabling movement, first identify the exact stable device symlink on the Pi with `ls -l /dev/serial/by-id/`, then edit `/etc/taptrack/nfc.env`:

```env
# Replace with the exact path returned on this Pi.
TAPTRACK_MOTOR_MODE=serial
TAPTRACK_MOTOR_SERIAL_DEVICE=/dev/serial/by-id/usb-1a86_USB_Single_Serial_5CBD018279-if00
TAPTRACK_MOTOR_BAUD_RATE=115200
TAPTRACK_MOTOR_RESPONSE_TIMEOUT_SECONDS=10
TAPTRACK_MOTOR_ACTUATION_ENABLED=false
```

The NFC service checks the stable path syntax and numeric settings at startup, but does not connect to the port while actuation is disabled. The loopback `/nfc/status` response reports the selected motor mode, actuation flag, serial connection state, and controller armed state. Keep actuation disabled: setting it true also requires explicit true configuration for installed limit switches, an installed emergency stop, and an approved recovery procedure. These flags are assertions, not a substitute for physical inspection or commissioning.

**Physical safety is not confirmed.** The firmware performs fixed-step motion without confirmed endpoint feedback; a `DONE` frame only confirms the firmware's routine completed and does not prove the shutter reached a safe endpoint. Do not enable actuation or connect TB6600 driver power until independent limit switches, an emergency stop, and a documented safe recovery procedure are installed and tested. The controller starts disarmed and will not send a command until an operator performs the non-moving recovery handshake described below. Do not upload firmware or issue motion commands during this deployment.

### Safe commissioning checklist

Commissioning is currently blocked. Keep `TAPTRACK_MOTOR_ACTUATION_ENABLED=false` and TB6600 driver power disconnected unless and until every item below is independently verified and approved:

- [ ] Independent limit switches are installed at the required endpoints and verified to inhibit unsafe travel.
- [ ] A hardwired emergency stop is installed and verified to remove motor-driver enable/power safely.
- [ ] The no-load/reset behavior has been reviewed so Pi/ESP32 startup, reset, disconnect, and brownout cannot cause unintended motion.
- [ ] A written recovery procedure covers power isolation, stationary-mechanism confirmation, ESP32 reset, and ambiguous/uncertain actions; operators are trained to follow it.
- [ ] The firmware and existing V2 protocol mapping have been reviewed against the installed hardware; `DONE` is not treated as position feedback.
- [ ] The exact `/dev/serial/by-id/` device path and `taptrack` serial permissions have been verified without issuing a movement command.
- [ ] A separate safety reviewer has approved the physical installation and recovery procedure before any future actuation authorization.

If an item is unchecked, do not energize the driver or enable actuation. This change does not authorize commissioning.

### Explicit operator recovery after safety approval

After all commissioning items above have been verified, configure `TAPTRACK_MOTOR_MODE=serial`, set `TAPTRACK_MOTOR_ACTUATION_ENABLED=true`, and set each safety confirmation variable to `true`. The service then exposes an owner-only Unix socket at `/run/taptrack/motor-control.sock`; it is not an HTTP/Cabinet endpoint. With the motor-driver power physically isolated, the mechanism stationary, and the ESP32 power-cycled, run the interactive command as the `taptrack` service account:

```bash
sudo -u taptrack /home/taptrack/tap-track/pi_service/.venv/bin/python \
  /home/taptrack/tap-track/pi_service/motor_recovery.py
```

The script requires an explicit `YES` for each physical confirmation. A successful recovery performs only the V2 serial handshake; it sends no movement command and does not prove shutter position. The service remains armed only for the lifetime of that process; after a restart or uncertain result, recovery must be repeated. Follow the separately approved physical procedure before reconnecting driver power. This workflow is intentionally unavailable in mock mode or when actuation is disabled.

Only after the approved safeguards and procedure are in place will a successful Cabinet `finish_open` or `finish_close` response from Django dispatch one serial command. Django workflow completion and ESP32 protocol completion are logged separately; neither proves the shutter reached its endpoint.

### Authorized commissioning sequence (future approval required)

This sequence is not authorized under the current project state. The current firmware is fixed-step and has no limit-switch inputs or physical position feedback. Independent hardware interlocks and a written, separately approved motion/recovery run-sheet are prerequisites; environment flags alone do not satisfy them.

1. With motor-driver power isolated and actuation still `false`, verify the active service user, unit paths, exact `/dev/serial/by-id/` device, baud rate, and `dialout` access. Do not probe the device by opening it.
2. Keep `TAPTRACK_MOTOR_ACTUATION_ENABLED=false` while installing the selected serial mode and exact device path. Start or reload the service only during an approved maintenance window, then confirm `/nfc/status` reports the expected mode, `actuation_enabled: false`, `armed: false`, and no connected serial port.
3. After a qualified reviewer signs off the limit switches, hardwired emergency stop, reset/brownout behavior, and recovery run-sheet, an authorized operator may enable actuation and set the three safety confirmation flags. Those settings are assertions and must match independently verified hardware.
4. With driver power still physically isolated, the trained operator follows the written isolation/stationary/ESP32 power-cycle procedure and runs the interactive recovery tool. Confirm only that the V2 handshake succeeds; this does not verify position.
5. Reconnect and energize the driver only as the approved run-sheet directs, with the emergency stop immediately accessible. Exercise one Cabinet `finish_open` or `finish_close` action at a time while the reviewer observes the independent limit/interlock indications and actual mechanism. Do not issue another action while one is active.
6. Stop, isolate power, and follow the approved recovery procedure after any timeout, disconnect, `BUSY`, rejection, unexpected travel, or uncertain result. Never automatically retry an uncertain command. Treat `DONE` only as protocol completion; independently verify the physical endpoint.
7. At the end of the approved test, disable actuation, confirm `/nfc/status` reports `actuation_enabled: false`, and document the test evidence and any faults before returning the cabinet to service.

The V2 protocol was checked against `motor/motor.ino`: the controller sends a nonce-correlated `HELLO,2` and expects `READY,2`, then sends the existing numeric station/action mapping and accepts only the matching `ACCEPTED`, `BUSY`, `DONE` response sequence. The controller does not retry a movement command. A timeout, malformed response, disconnect, or interrupted process leaves the durable action un-retryable and requiring manual review. Startup converts leftover `PENDING`/`DISPATCHED` actions to `UNCERTAIN`; run exactly one NFC service process to avoid one process recovering another live process's action. Persistent action records suppress duplicates but do not prove exactly-once physical execution or position.

`pyserial` is included in `pi_service/requirements.txt`. The confirmed service account is `taptrack`; verify serial-group access before commissioning:

```bash
id taptrack
sudo usermod -aG dialout taptrack
sudo systemctl restart taptrack-nfc.service
ls -l /dev/serial/by-id/
```

After adding a user to `dialout`, start a new login session or reboot before checking the group. Do not restart the production service merely to test access unless you have verified the active checkout and unit first.

### Safe rollback to mock motor mode

To disable serial use without changing the Cabinet UI or Django authentication, edit `/etc/taptrack/nfc.env`:

```env
TAPTRACK_MOTOR_MODE=mock
TAPTRACK_MOTOR_ACTUATION_ENABLED=false
```

Then restart only the NFC service and verify it is healthy:

```bash
sudo systemctl restart taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
curl -fsS http://127.0.0.1:5001/nfc/status
```

Inspect the `motor` object in the status JSON. The safe configured state is `mode: serial`, `actuation_enabled: false`, `serial_connection: disconnected`, `armed: false`.

Mock mode never actuates motors. Do not delete SQLite action history during rollback; uncertain and terminal records are retained to prevent accidental duplicate movement.

The Pi, shared physical NFC reader, and Cabinet screen use one unique `DEVICE_API_KEY`. Map that device to the Cabinet on the Django server with `TAPTRACK_NFC_DEVICE_MAP`; do not bind it to a logical station:

```env
TAPTRACK_NFC_DEVICE_MAP=[{"device_id":"CABINET1-PI","api_key":"<cabinet-reader-key>","cabinet_name":"Cabinet 1","active":true}]
```

Django derives the Cabinet from the authenticated device. The Cabinet screen selects one of the configured logical stations for each open or close workflow; Django attributes real NFC scans to that active session. The browser sends workflow commands through the Pi bridge and never receives reader keys.

## Build the Cabinet UI

```bash
cd /home/taptrack/tap-track/cabinet
npm run build
```

The Vite output directory is the default Vite build folder from `cabinet/package.json` and `cabinet/vite.config.js`.
The `taptrack-cabinet.service` unit rebuilds the UI after loading `/etc/taptrack/cabinet.env`; the bridge URL is compiled into the served bundle on service restart. The Cabinet always uses the hardware NFC bridge and does not accept a mock provider mode.

## Start the NFC service

Use a systemd service:

```bash
sudo cp /home/taptrack/tap-track/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/
sudo install -d -m 700 /etc/taptrack
if [ ! -e /etc/taptrack/nfc.env ]; then
  sudo install -m 600 /home/taptrack/tap-track/pi_service/deploy/nfc.env.example /etc/taptrack/nfc.env
fi
# Edit /etc/taptrack/nfc.env locally and set DEVICE_API_KEY; do not commit this file.
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service
sudo systemctl start taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
```

The service starts from `/home/taptrack/tap-track/pi_service`, runs as `taptrack`, restarts if it crashes, detects `IC Reader IC Reader`, and binds the read-only scan bridge to `127.0.0.1:5001`. SQLite events are stored at `/home/taptrack/tap-track/pi_service/nfc_events.sqlite3` by default. The Django device key is read only from `/etc/taptrack/nfc.env`. Preserve the existing secret file when updating code; do not overwrite it with the example template.

## Start the Cabinet UI

Use the preview server from the built app:

```bash
sudo cp /home/taptrack/tap-track/pi_service/deploy/taptrack-cabinet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable taptrack-cabinet.service
sudo systemctl start taptrack-cabinet.service
sudo systemctl status taptrack-cabinet.service
```

This starts the built app on `127.0.0.1:4000`. The bridge CORS allow-list contains only the Cabinet origins on port 4000.

## Browser kiosk mode

Install a desktop autostart file:

```bash
mkdir -p /home/pi/.config/autostart
cp /home/taptrack/tap-track/pi_service/deploy/taptrack-kiosk.desktop /home/pi/.config/autostart/
```

This launches Chromium in kiosk mode and hides browser controls.

For a full-screen kiosk experience, Chromium is launched with:

```bash
/usr/bin/chromium --kiosk --disable-infobars --noerrdialogs --disable-session-crashed-bubble --disable-features=TranslateUI --user-data-dir=/home/pi/.config/taptrack-chromium http://127.0.0.1:4000
```

## Test the scan bridge

This is a read-only request and does not create Django access records:

```bash
curl -i 'http://127.0.0.1:5001/api/scans?after=0&limit=50'
```

This GET is read-only and does not create Django access records. For each complete physical UID, the NFC daemon sends exactly one `POST http://127.0.0.1:8000/api/verify-nfc/` using `DEVICE_API_KEY` from `/etc/taptrack/nfc.env`, then stores one result event. The browser only reads the bridge and never receives the API key. Do not test by manually posting a UID unless you intend to create Django access/event records.

## Service management

Start:

```bash
sudo systemctl start taptrack-nfc.service
sudo systemctl start taptrack-cabinet.service
```

Stop:

```bash
sudo systemctl stop taptrack-nfc.service
sudo systemctl stop taptrack-cabinet.service
```

Restart:

```bash
sudo systemctl restart taptrack-nfc.service
sudo systemctl restart taptrack-cabinet.service
```

Status:

```bash
sudo systemctl status taptrack-nfc.service
sudo systemctl status taptrack-cabinet.service
```

## Maintenance mode

To access the desktop instead of kiosk mode, exit Chromium or use the desktop session normally.

To kill kiosk mode temporarily:

```bash
pkill -f chromium
```

Then launch Chromium without kiosk flags if needed.

## Troubleshooting

### Black screen

- Check that the browser is running and the Cabinet service is active.
- Check the browser log and `journalctl -u taptrack-cabinet.service`.
- Verify the app served on port 4000.

### Browser not starting

```bash
journalctl -u taptrack-cabinet.service -f
```

### NFC reader unavailable

```bash
journalctl -u taptrack-nfc.service -f
```

Check the reader adapter and confirm that the NFC service is healthy at `http://127.0.0.1:5001/nfc/status`.

### Django unavailable

- Confirm the Django server is reachable from the Pi.
- Check the network address in `VITE_DJANGO_API_BASE_URL`.
- Test with `curl` from the Pi.

### Network unavailable

- Ensure the Pi is connected to the same Wi-Fi/Ethernet segment as the Django server.
- Check `ip address` and `ping` to the Django host.

## Reboot verification

After a reboot:

```bash
sudo systemctl status taptrack-nfc.service
sudo systemctl status taptrack-cabinet.service
curl http://127.0.0.1:4000
```

The Cabinet should automatically return to the TapTrack landing screen and display the normal idle “Tap your NFC card” state.

## Security notes

- Keep the device API key only in `/etc/taptrack/nfc.env` with restrictive permissions.
- Do not commit production secrets to Git.
- Do not expose the Django API or database publicly.
- The scan bridge must remain bound to loopback port 5001; do not bind it to `0.0.0.0`.
