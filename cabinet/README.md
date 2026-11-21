# TapTrack Cabinet UI

## Raspberry Pi preparation

This is the official Raspberry Pi Cabinet touchscreen UI, built with React 19 and Vite 8. It reads verification results from the Pi-local NFC scan bridge, which forwards real NFC scans and cabinet workflow requests to the configured Django API. The browser never receives the server-side device API key.

Requirements: Raspberry Pi OS 64-bit recommended, Node.js 22.12 or newer, npm 10 or newer, Nginx, Chromium, and internet access to the deployed TapTrack API. NFC, camera, and motor-controller communication remain on the Pi.

Check versions:

```bash
node --version
npm --version
```

Use `/home/taptrack/tap-track` on the Pi; the NFC and Cabinet systemd units in `pi_service/deploy` use this checkout. Clone the repository there, then run:

```bash
git clone <your-repository-url> /home/taptrack/tap-track
cd /home/taptrack/tap-track/cabinet
npm ci
```

Install the Pi tools and Python runtime:

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv nginx chromium
```

Install Node.js 22 with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22.12.0
nvm alias default 22.12.0
```

The checked-in `cabinet/.env.production` contains only public same-origin paths; it has no credentials and overrides workstation-specific `.env.local` values during production builds. Keep device keys out of all `VITE_` variables. Build the production bundle:

The production Nginx server on port 5177 serves `dist/`, proxies `/nfc-bridge/*` to the Pi-local NFC service on `127.0.0.1:5001`, and proxies `/api/*` to `https://taptrack-api.onrender.com/api/`. Browser requests stay same-origin. Nginx resolves the Render hostname on demand so the local UI can start while the internet is unavailable. The Pi NFC service independently uses the same Render API base and adds its device key server-side.

The Cabinet uses the registration URL returned by Django without rewriting its host or token. Configure `TAPTRACK_NFC_REGISTRATION_URL_BASE=https://taptrack-registration.onrender.com/register` in the deployed Django environment so registration QR codes open the public registration site, not the Web Portal or Cabinet UI:

```bash
cd /home/taptrack/tap-track/cabinet
npm run build
```

The existing `taptrack-cabinet.service` serves this bundle with the Nginx config at `cabinet/deploy/nginx.conf` on port 5177. The existing `taptrack-nfc.service` remains the only reader, camera, workflow, and motor-controller process. The optional `taptrack-kiosk.service` opens Chromium at `http://127.0.0.1:5177` after the graphical desktop and Cabinet server are available. See `pi_service/deploy/README.md` for opt-in installation and startup steps.

For development only, `npm run dev` remains available with the Vite proxy; it is not used for normal Raspberry Pi operation. Do not run Vite preview or the development server alongside the production Nginx listener on port 5177.

The Portal normally remains on Render. For local Portal development on a workstation, use a separate port so it does not conflict with the Cabinet's Raspberry Pi port 5177:

```bash
cd /path/to/CapstoneCabinet/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5178
```

Production registration links should use `https://taptrack-web.onrender.com/register?token=<temporary-token>`. Django generates the temporary token; the raw NFC UID is never included. This Portal is separate from the local Cabinet UI.

In the deployed Django environment, map the Pi's single device key to the Cabinet in `TAPTRACK_NFC_DEVICE_MAP`. Stations come from `TAPTRACK_CABINET_STATIONS`. Store `DEVICE_API_KEY` only in `/etc/taptrack/nfc.env`; never put it in a Cabinet `VITE_` variable or browser bundle. The repository has a top-level `backend/` for development; it does not contain a separate `cabinet/backend/`, and no local Pi Django service is required for the production Cabinet UI.

The NFC service uses only Python's standard library, so no Python package installation is required. The existing `taptrack-nfc.service` runs the single local reader/bridge process; it also owns camera capture and guarded motor-controller integration. For manual development only, run it separately from the UI:

```bash
cd /home/taptrack/tap-track/pi_service
python3 nfc_service.py
```

The NFC service reads the card, sends the UID to Django with its server-side device key, and exposes scan results and workflow commands through its localhost bridge. Django derives the station and cabinet from the authenticated reader identity and owns the active session.

The Cabinet UI has no mock NFC mode or manual UID entry. Automated tests use isolated fake providers; normal users must scan a real card on the NFC reader.

The NFC service contract remains `GET /api/scans?after=<event_id>&limit=50` and `GET/POST /cabinet/workflow` on its loopback listener. The Cabinet browser reaches it through its same-origin `/nfc-bridge/*` proxy; the browser sends only workflow commands and never receives the device API key.

Password Recovery uses the same active Pi NFC service: Cabinet sends the opaque `request_id` to same-origin `POST /nfc-bridge/password-reset/handoff`; the Pi claims it with Django's device key and routes only the next card to `/api/auth/password-reset/verify-nfc/`. The Web UI polls same-origin `POST /api/auth/password-reset/status/` and advances only when the backend returns `verified` with a short-lived reset authorization. The Cabinet polls backend and local reader status but never receives that authorization. Recovery scans are separate from normal access events, photo capture, and motor workflow dispatch. The legacy `pi_service/password_reset_service.py` prototype on port 8765 is not the production scanner.

The QR contains the registration URL and short-lived token returned by Django. The Cabinet does not override the registration URL; the Django setting is the single source of truth. A successful open/close workflow response confirms the Django session transition only; it does not verify physical shutter movement. Keep TB6600 motor-driver power disconnected until limit switches and an emergency stop are installed.

<!-- Cabinet deployment instructions above are the project documentation. -->

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
