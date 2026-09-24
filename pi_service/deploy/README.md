# TapTrack Raspberry Pi deployment

## Overview

This repository supports running the TapTrack Cabinet UI as a dedicated kiosk application on a Raspberry Pi.

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

```bash
mkdir -p /home/pi/apps
cd /home/pi/apps
git clone <repo-url> taptrack-cabinet
cd /home/pi/apps/taptrack-cabinet
```

## Install Python dependencies

```bash
cd /home/pi/apps/taptrack-cabinet/pi_service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Install Cabinet dependencies

```bash
cd /home/pi/apps/taptrack-cabinet/cabinet
npm install
```

## Required environment variables

Create `/etc/taptrack/cabinet.env` and set values like:

```env
VITE_DJANGO_API_BASE_URL=http://192.168.1.100:8000/api
VITE_DJANGO_API_KEY=replace-with-production-device-key
VITE_DJANGO_SERVER_URL=http://192.168.1.100:8000
VITE_NFC_SERVICE_URL=http://127.0.0.1:5000
VITE_NFC_MODE=hardware
VITE_NFC_COOLDOWN_MS=2500
VITE_WEB_APP_BASE_URL=http://192.168.1.100:5176
```

Important:

- Do not use `localhost` or `127.0.0.1` for the Django address unless Django is running on the same Pi.
- Keep the API key in a local environment file, not in Git.
- Keep the Portal QR base URL reachable by student phones.

## Build the Cabinet UI

```bash
cd /home/pi/apps/taptrack-cabinet/cabinet
npm run build
```

The Vite output directory is the default Vite build folder from `cabinet/package.json` and `cabinet/vite.config.js`.

## Start the NFC service

Use a systemd service:

```bash
sudo cp /home/pi/apps/taptrack-cabinet/pi_service/deploy/taptrack-nfc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable taptrack-nfc.service
sudo systemctl start taptrack-nfc.service
sudo systemctl status taptrack-nfc.service
```

The service starts from `/home/pi/apps/taptrack-cabinet/pi_service` and restarts automatically if it crashes.

## Start the Cabinet UI

Use the preview server from the built app:

```bash
sudo cp /home/pi/apps/taptrack-cabinet/pi_service/deploy/taptrack-cabinet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable taptrack-cabinet.service
sudo systemctl start taptrack-cabinet.service
sudo systemctl status taptrack-cabinet.service
```

This starts the built app on port 5173.

## Browser kiosk mode

Install a desktop autostart file:

```bash
mkdir -p /home/pi/.config/autostart
cp /home/pi/apps/taptrack-cabinet/pi_service/deploy/taptrack-kiosk.desktop /home/pi/.config/autostart/
```

This launches Chromium in kiosk mode and hides browser controls.

For a full-screen kiosk experience, Chromium is launched with:

```bash
/usr/bin/chromium --kiosk --disable-infobars --noerrdialogs --disable-session-crashed-bubble --disable-features=TranslateUI --user-data-dir=/home/pi/.config/taptrack-chromium http://127.0.0.1:5173
```

## Test the Django connection

On the Raspberry Pi:

```bash
curl -i http://192.168.1.100:8000/api/verify-nfc/
```

The request should be authenticated by the configured device API key. The Cabinet uses `VITE_DJANGO_API_KEY` to send the `X-API-Key` header.

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
- Verify the app served on port 5173.

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
curl http://127.0.0.1:5173
```

The Cabinet should automatically return to the TapTrack landing screen and display the normal idle “Tap your NFC card” state.

## Security notes

- Keep device API keys in `/etc/taptrack/cabinet.env` or an equivalent local config directory.
- Do not commit production secrets to Git.
- Do not expose the Django API or database publicly.
- Only expose the needed ports on the private network.

## Mock mode for development

For development or laptop testing, use:

```bash
cd /home/pi/apps/taptrack-cabinet/cabinet
VITE_NFC_MODE=mock npm run dev -- --host 0.0.0.0
```

This keeps the manual mock NFC input available without requiring a Raspberry Pi reader.
