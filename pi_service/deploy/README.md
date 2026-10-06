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

Use the confirmed checkout path `/home/pi/tap-track`:

```bash
git clone <repo-url> /home/pi/tap-track
cd /home/pi/tap-track
```

## Install Python dependencies

```bash
cd /home/pi/tap-track/pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Install Cabinet dependencies

```bash
cd /home/pi/tap-track/cabinet
npm install
```

## Required environment variables

Set Cabinet browser build-time values in `cabinet/.env.production` before building:

```env
VITE_NFC_MODE=hardware
VITE_NFC_BRIDGE_URL=http://127.0.0.1:5001/api/scans
VITE_WEB_APP_BASE_URL=http://192.168.1.100:5176
```

Important:

- VITE values are compiled into the browser bundle. Never put `DEVICE_API_KEY` or a Django API key in VITE variables.
- Keep the Portal QR base URL reachable by student phones.

Put `DEVICE_API_KEY` only in `/etc/taptrack/nfc.env`, loaded only by the NFC systemd service. Set that file to mode `0600`. Never pass it to the Cabinet preview process or place it in a `VITE_` variable.

The Pi, shared physical NFC reader, and Cabinet screen use one unique `DEVICE_API_KEY`. Map that device to the Cabinet on the Django server with `TAPTRACK_NFC_DEVICE_MAP`; do not bind it to a logical station:

```env
TAPTRACK_NFC_DEVICE_MAP=[{"device_id":"CABINET1-PI","api_key":"<cabinet-reader-key>","cabinet_name":"Cabinet 1","active":true}]
```

Django derives the Cabinet from the authenticated device. The Cabinet screen selects one of the configured logical stations for each open or close workflow; Django attributes real NFC scans to that active session. The browser sends workflow commands through the Pi bridge and never receives reader keys.

## Build the Cabinet UI

```bash
cd /home/pi/tap-track/cabinet
npm run build
```

The Vite output directory is the default Vite build folder from `cabinet/package.json` and `cabinet/vite.config.js`.

## Start the NFC service

Use a systemd service:

```bash
sudo cp /home/pi/tap-track/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/
sudo install -d -m 700 /etc/taptrack
sudo install -m 600 /home/pi/tap-track/pi_service/deploy/nfc.env.example /etc/taptrack/nfc.env
# Edit /etc/taptrack/nfc.env locally and set DEVICE_API_KEY; do not commit this file.
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service
sudo systemctl start taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
```

The service starts from `/home/pi/tap-track/pi_service`, restarts if it crashes, detects `IC Reader IC Reader`, and binds the read-only scan bridge to `127.0.0.1:5001`. SQLite events are stored at `/home/pi/tap-track/pi_service/nfc_events.sqlite3` by default. The Django device key is read only from `/etc/taptrack/nfc.env`.

## Start the Cabinet UI

Use the preview server from the built app:

```bash
sudo cp /home/pi/tap-track/pi_service/deploy/taptrack-cabinet.service /etc/systemd/system/
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
cp /home/pi/tap-track/pi_service/deploy/taptrack-kiosk.desktop /home/pi/.config/autostart/
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

Check the reader adapter and confirm that `VITE_NFC_MODE=hardware` is set only when the reader is connected.

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

## Mock mode for development

For development or laptop testing, use:

```bash
cd /home/pi/tap-track/cabinet
VITE_NFC_MODE=mock npm run dev -- --host 0.0.0.0
```

This keeps the manual mock NFC input available without requiring a Raspberry Pi reader.
