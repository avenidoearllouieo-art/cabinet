# TapTrack Raspberry Pi deployment

For the Phase 1 OPEN-only bench and UUID dispatch update, use the
[integrated rollout and rollback runbook](../../docs/MOTOR_SESSION_IDENTITY_FIX.md).
Its deployment steps use the active systemd configuration, SQLite journal, and
Nginx document root. The installation examples below use historical paths.

## Overview

This repository runs the official Cabinet touchscreen UI and Pi-local NFC reader/scan bridge.

The target boot order is:

1. OS boots
2. The existing Python NFC service starts and initializes the local reader, camera adapter, and guarded motor controller
3. Nginx serves the prebuilt Cabinet UI and local/reverse-proxy routes on port 5177
4. Chromium opens the Cabinet in kiosk mode after the desktop is ready
5. Students see the TapTrack Cabinet home screen and tap their NFC card

There is no `cabinet/backend/` in this checkout. The top-level `backend/` is the development Django project; on the Pi, shared application data and authentication are authoritative on `https://taptrack-api.onrender.com`. No local Django, camera, or motor service is added: photo capture and motor-controller integration already run inside the single `taptrack-nfc.service` process.

## Required OS and runtime

- Raspberry Pi OS (64-bit recommended)
- Raspberry Pi with touchscreen/LCD connected
- Internet access to `taptrack-api.onrender.com` for authenticated shared data
- Node.js 22.x recommended
- Python 3.11+
- Chromium browser
- Nginx (serves the static production build and proxies API/bridge routes)

## Required packages

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv python3-pip nginx chromium x11-xserver-utils
```

If needed, install Node.js 22 with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22.12.0
nvm alias default 22.12.0
```

## Repository setup

The confirmed live NFC-service checkout is `/home/taptrack/tap-track-clean`. Verify the active unit before changing it:

```bash
sudo systemctl cat taptrack-nfc.service
sudo systemctl show taptrack-nfc.service -p User -p WorkingDirectory -p ExecStart
cd /home/taptrack/tap-track-clean
git status --short
```

Before updating, confirm the service unit's `WorkingDirectory` and `ExecStart` match this checkout and the Git branch/remotes are the expected deployment source. Do not overwrite `/etc/taptrack/nfc.env` or SQLite files. After the reviewed change is available on the Pi:

```bash
cd /home/taptrack/tap-track-clean
git status --short
git branch --show-current
git remote -v
git pull --ff-only
```

Only restart the NFC service for Pi-service changes. If deploying the updated unit file, first inspect the diff and then install it and reload systemd:

```bash
sudo cp /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/taptrack-nfc.service
sudo systemctl daemon-reload
sudo systemctl restart taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
curl -fsS http://127.0.0.1:5001/nfc/status
```

This is a deployment procedure only; these commands were not run as part of this task. Do not run any motor recovery or change the safe environment defaults until the physical safety checklist is complete.

## Install Python dependencies

```bash
cd /home/taptrack/tap-track-clean/pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Install Cabinet dependencies

```bash
cd /home/taptrack/tap-track-clean/cabinet
npm ci
```

## Production Cabinet build and routes

Set these public browser build-time values in `cabinet/.env.production`:

```env
VITE_NFC_BRIDGE_URL=/nfc-bridge/api/scans
VITE_DJANGO_API_BASE_URL=/api
VITE_NFC_COOLDOWN_MS=2500
```

Build the optimized static bundle once during installation or an intentional UI update; it is not rebuilt at boot:

```bash
cd /home/taptrack/tap-track-clean/cabinet
npm run build
test -f dist/index.html
```

The production systemd unit runs Nginx using `cabinet/deploy/nginx.conf` on port 5177. React Router routes fall back to `index.html`. The same-origin routes are:

- `/nfc-bridge/*` -> Pi-local `127.0.0.1:5001`; only the existing `nfc_service.py` accesses the reader, camera, and motor-controller integration.
- `/api/*` -> `https://taptrack-api.onrender.com/api/*`; this is the shared source of users, NFC verification, access history, and recovery data.

Nginx resolves the Render host on demand. If the site network blocks public DNS resolvers, replace the `resolver` addresses in `cabinet/deploy/nginx.conf` with the approved DNS servers for that network. If Render is unavailable, Nginx continues to serve the local Cabinet bundle; API calls return errors, NFC verification fails closed, and no offline authentication or motor bypass is enabled. The proxy does not retry POST requests.

The Cabinet polls the Pi-local scan bridge at its existing 750 ms cadence with an in-flight guard and persistent cursor to keep NFC feedback responsive. The live clock updates in isolated child widgets instead of re-rendering the entire Cabinet app each second. Password-recovery status checks use a two-second normal interval with bounded backoff on network failures. No motor command is issued by UI or service startup.

`npm run dev` remains the separate development workflow and continues to use the Vite proxy. Do not run Vite preview/dev on 5177 at the same time as the production Nginx service. Keep `VITE_DJANGO_SERVER_URL` in the development environment only. Never put API credentials or `DEVICE_API_KEY` in any `VITE_` variable.

## Required environment variables

Install the Pi-side device environment at `/etc/taptrack/nfc.env`, readable only by the `taptrack` service user (directory owned by `taptrack`, mode 0700; file owned by `taptrack`, mode 0600). Start from `pi_service/deploy/nfc.env.example`, set a real unique `DEVICE_API_KEY`, and retain all existing motor-safety values:

```env
DEVICE_API_KEY=<secret device key mapped in Django>
TAPTRACK_DJANGO_API_BASE_URL=https://taptrack-api.onrender.com/api
TAPTRACK_NFC_ALLOWED_ORIGINS=http://localhost:5177,http://127.0.0.1:5177
TAPTRACK_NFC_MODE=hardware
TAPTRACK_NFC_DB_PATH=/home/taptrack/tap-track-clean/pi_service/nfc_events.sqlite3
TAPTRACK_MOTOR_MODE=serial
TAPTRACK_MOTOR_ACTUATION_ENABLED=false
```

Do not copy the placeholder key literally. Add the exact `http://<Pi-LAN-host-or-IP>:5177` origin to `TAPTRACK_NFC_ALLOWED_ORIGINS` only when the Cabinet is intentionally opened from that address (for phone registration or administration). Origins must be exact scheme/host/port values without paths. Put the matching device-key mapping in the deployed Django `TAPTRACK_NFC_DEVICE_MAP`. No key is sent to the browser or Nginx.

When preparing a new secret directory, use:

```bash
sudo install -d -o taptrack -g taptrack -m 0700 /etc/taptrack
sudo install -o taptrack -g taptrack -m 0600 pi_service/deploy/nfc.env.example /etc/taptrack/nfc.env
sudoedit /etc/taptrack/nfc.env
```

Do not overwrite an existing `/etc/taptrack/nfc.env`; update it in place while preserving its secret values and mode.

The DNS resolver in `cabinet/deploy/nginx.conf` and the Pi service API base must both resolve/reach Render. A missing internet connection does not stop Nginx or the Cabinet UI; authentication and protected writes remain unavailable until Render reconnects.

`TAPTRACK_NFC_ALLOWED_ORIGINS` must contain exact browser origins for the Cabinet. The production kiosk uses `http://127.0.0.1:5177`; add `http://localhost:5177` and the exact LAN origin only if those URLs are actually used. The existing Vite development server may use `http://127.0.0.1:4000` or `http://localhost:4000`. Origins must be HTTP(S) scheme + host + optional port only. Paths, wildcards, `null`, and arbitrary forwarded headers are not accepted. Handoff/cancel POSTs and bridge-status GETs with an Origin require an exact allowlist match. A missing Origin is accepted only for the read-only bridge-status GET because browsers may omit Origin on same-origin GET requests; CORS headers are still emitted only for an exact allowed Origin. The service does not derive trust from `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto`.

## Opt-in automatic startup

These are instructions only; the units are not installed or enabled by this repository change. First inspect the Pi's current services and processes. The checkout already has `taptrack-nfc.service`; it owns the single NFC reader, local scan bridge, camera photo integration, and motor-controller instance. Do not start a second NFC service or a separate motor/camera process. There is no local Pi Django service in this checkout; Django is Render-authoritative.

Before enabling kiosk mode, configure Raspberry Pi OS desktop autologin for user `pi`, verify the display is available as `DISPLAY=:0` with `/home/pi/.Xauthority`, and disable any existing Chromium kiosk autostart so only one browser is launched. The supplied kiosk unit assumes that X11 session layout; adapt its display environment if the Pi uses a different desktop/session configuration.

After configuring `/etc/taptrack/nfc.env`, building the Cabinet bundle, and checking that the current worktree/paths match `/home/taptrack/tap-track-clean`, install the Cabinet server and kiosk unit templates:

```bash
sudo install -m 0644 /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-cabinet.service /etc/systemd/system/taptrack-cabinet.service
sudo install -m 0644 /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-kiosk.service /etc/systemd/system/taptrack-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
sudo systemctl start taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
```

Check services and routes without sending any motor command:

```bash
systemctl is-active taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
curl --fail --silent http://127.0.0.1:5001/nfc/status
curl --fail --silent http://127.0.0.1:5177/ -o /dev/null
```

The NFC service starts with its existing motor actuation setting, which remains disabled in the example. Neither Nginx nor Chromium sends motor commands. Do not enable motor actuation, run motor recovery, reboot, install, or enable these units without the operator's explicit approval and the physical safety checklist below.

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
cp -p /home/taptrack/tap-track-clean/pi_service/nfc-service.env /home/taptrack/tap-track-clean/pi_service/nfc-service.env.before-origin-fix
sudoedit /home/taptrack/tap-track-clean/pi_service/nfc-service.env
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
cp -p /home/taptrack/tap-track-clean/pi_service/nfc-service.env.before-origin-fix /home/taptrack/tap-track-clean/pi_service/nfc-service.env
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
sudo -u taptrack /home/taptrack/tap-track-clean/pi_service/.venv/bin/python \
  /home/taptrack/tap-track-clean/pi_service/motor_recovery.py
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
cd /home/taptrack/tap-track-clean/cabinet
npm run build
```

The Vite output directory is `cabinet/dist`. Build it manually when installing or updating the UI; the systemd service only serves the existing bundle and does not rebuild during boot. The Cabinet always uses the hardware NFC bridge and does not accept a mock provider mode.

## Start the NFC service

Use a systemd service:

```bash
sudo cp /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/
sudo install -d -m 700 /etc/taptrack
if [ ! -e /etc/taptrack/nfc.env ]; then
  sudo install -o taptrack -g taptrack -m 600 /home/taptrack/tap-track-clean/pi_service/deploy/nfc.env.example /etc/taptrack/nfc.env
fi
# Edit /etc/taptrack/nfc.env locally and set DEVICE_API_KEY; do not commit this file.
# Keep the file owned by taptrack with mode 0600; the Cabinet creates a private
# Nginx include for protected photo reads from this same file at service start.
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service
sudo systemctl start taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
```

The service starts from `/home/taptrack/tap-track-clean/pi_service`, runs as `taptrack`, restarts if it crashes, detects `IC Reader IC Reader`, and binds the read-only scan bridge to `127.0.0.1:5001`. SQLite events are stored at `/home/taptrack/tap-track-clean/pi_service/nfc_events.sqlite3` by default. The Django device key is read only from `/etc/taptrack/nfc.env`. Preserve the existing secret file when updating code; do not overwrite it with the example template.

## Install Cabinet and kiosk units (opt-in)

Build the bundle first using the commands above. Check that the current checkout matches `/home/taptrack/tap-track-clean`, that no manual Vite/preview process is already using port 5177, and that only one Chromium autostart mechanism will be enabled. Install the existing NFC service plus the Cabinet and kiosk unit templates:

```bash
sudo install -m 0644 /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-cabinet.service /etc/systemd/system/taptrack-cabinet.service
sudo install -m 0644 /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-kiosk.service /etc/systemd/system/taptrack-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
sudo systemctl start taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
sudo systemctl status taptrack-nfc.service taptrack-cabinet.service taptrack-kiosk.service
```

This starts Nginx on `127.0.0.1:5177`. The NFC service is the single local process for reader, camera, workflow, and motor-controller integration. The UI service starts even when Render is offline; in that state the Cabinet remains visible, shared-data requests fail closed, and no offline authentication is provided.

`taptrack-kiosk.service` assumes an X11 desktop session for user `pi`, with `DISPLAY=:0` and `/home/pi/.Xauthority`. Configure Raspberry Pi OS desktop autologin and verify those values before enabling it. An existing `taptrack-kiosk.desktop` autostart file is also available as an alternative. Use one option only; do not enable the systemd kiosk unit while the desktop autostart entry is installed.

To use the desktop autostart alternative instead of `taptrack-kiosk.service`:

```bash
mkdir -p /home/pi/.config/autostart
cp /home/taptrack/tap-track-clean/pi_service/deploy/taptrack-kiosk.desktop /home/pi/.config/autostart/
```

Do not install both kiosk autostart options.

## Test the scan bridge

This is a read-only request and does not create Django access records:

```bash
curl -i 'http://127.0.0.1:5001/api/scans?after=0&limit=50'
```

This GET is read-only and does not create Django access records. For each complete physical UID, the NFC daemon sends exactly one `POST https://taptrack-api.onrender.com/api/verify-nfc/` using `DEVICE_API_KEY` from `/etc/taptrack/nfc.env`, then stores one result event. The browser only reads the bridge and never receives the API key. Do not test by manually posting a UID unless you intend to create Django access/event records.

## Service management

Start:

```bash
sudo systemctl start taptrack-nfc.service
sudo systemctl start taptrack-cabinet.service
sudo systemctl start taptrack-kiosk.service
```

Stop:

```bash
sudo systemctl stop taptrack-nfc.service
sudo systemctl stop taptrack-cabinet.service
sudo systemctl stop taptrack-kiosk.service
```

Restart:

```bash
sudo systemctl restart taptrack-nfc.service
sudo systemctl restart taptrack-cabinet.service
sudo systemctl restart taptrack-kiosk.service
```

Status:

```bash
sudo systemctl status taptrack-nfc.service
sudo systemctl status taptrack-cabinet.service
sudo systemctl status taptrack-kiosk.service
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
- Verify the app is served on port 5177.

### Browser not starting

```bash
journalctl -u taptrack-cabinet.service -f
```

### NFC reader unavailable

```bash
journalctl -u taptrack-nfc.service -f
```

Check the reader adapter and confirm that the NFC service is healthy at `http://127.0.0.1:5001/nfc/status`.

### Deployed Django unavailable

- Confirm the Pi can resolve and reach `taptrack-api.onrender.com`.
- Check `TAPTRACK_DJANGO_API_BASE_URL` in `/etc/taptrack/nfc.env` and the Render route in `cabinet/deploy/nginx.conf`.
- Test with `curl` from the Pi.

### Cabinet workflow returns HTTP 502

The local `/cabinet/workflow` bridge forwards to `TAPTRACK_DJANGO_API_BASE_URL/cabinet/workflow/`. A refused or timed-out connection is reported locally as HTTP 502. The supported production base is `https://taptrack-api.onrender.com/api`; do not point it at `127.0.0.1:8000` unless Django actually runs on the Pi. The request uses `X-API-Key` from `/etc/taptrack/nfc.env`; Django must map that same key to an active cabinet in `TAPTRACK_NFC_DEVICE_MAP`. A 401 from `/api/` alone does not verify the device key or workflow route.

Back up and edit only the Pi environment file. Preserve `DEVICE_API_KEY` and the motor safety values; remove stale legacy URL entries if present:

```bash
sudo cp -a /etc/taptrack/nfc.env "/etc/taptrack/nfc.env.backup.$(date +%Y%m%d-%H%M%S)"
sudoedit /etc/taptrack/nfc.env
```

Set `TAPTRACK_DJANGO_API_BASE_URL=https://taptrack-api.onrender.com/api`. Then inspect the active unit and any drop-ins without printing its full environment (which could contain credentials):

```bash
sudo systemctl show taptrack-nfc.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p WorkingDirectory -p ExecStart
sudo grep -RniE 'TAPTRACK_DJANGO_(API_BASE|VERIFY|WORKFLOW)_URL' /etc/systemd/system/taptrack-nfc.service.d 2>/dev/null || true
```

If a drop-in sets an old Django URL, edit that existing drop-in with `sudo systemctl edit taptrack-nfc.service` and remove only the stale `Environment=TAPTRACK_DJANGO_*_URL=...` assignment; keep `/etc/taptrack/nfc.env` as the source of the corrected base URL and preserve all other directives. If an extra `EnvironmentFile` contains an old URL, edit that file in place instead. Do not add a duplicate drop-in, reset unrelated environment files, or put `DEVICE_API_KEY` in a unit override. If the main unit still points to an old checkout, review and back it up before installing the matching template from `/home/taptrack/tap-track-clean/pi_service/deploy/taptrack-nfc.service`.

After saving changes, reload and restart only the NFC service when no password-recovery handoff or workflow is active. The GET below is read-only and does not issue a motor command:

```bash
sudo systemctl daemon-reload
sudo systemctl restart taptrack-nfc.service
sudo systemctl status taptrack-nfc.service --no-pager
curl --fail-with-body --silent --show-error http://127.0.0.1:5001/cabinet/workflow
sudo journalctl -u taptrack-nfc.service -n 50 --no-pager
```

On HTTP 401/403, verify the Render `TAPTRACK_NFC_DEVICE_MAP` entry is active and contains the exact existing Pi key and cabinet name. Never print or paste the key into logs, browser configuration, or support output.

### Network unavailable

- The Cabinet UI remains local; authenticated NFC and shared-data operations wait for connectivity and fail closed while Render is unavailable.
- Check `ip address` and DNS resolution for the configured network.

## Reboot verification

After a reboot:

```bash
sudo systemctl status taptrack-nfc.service
sudo systemctl status taptrack-cabinet.service
curl --fail --silent http://127.0.0.1:5177/ -o /dev/null
```

The Cabinet should automatically return to the TapTrack landing screen and display the normal idle “Tap your NFC card” state.

## Security notes

- Keep the device API key only in `/etc/taptrack/nfc.env` with restrictive permissions.
- Do not commit production secrets to Git.
- Do not expose the Django API or database publicly.
- The scan bridge must remain bound to loopback port 5001; do not bind it to `0.0.0.0`.
