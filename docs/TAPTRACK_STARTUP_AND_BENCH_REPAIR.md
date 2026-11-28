# TapTrack kiosk startup and unloaded bench repair

The corrective patch applies to published commit d4b64de. The previous
deployment reference is 84c63a1. Apply the Cabinet build and bridge code
together. The Cabinet now uses a bridge-provided scan watermark on entering
each scan view and after a feed error. A bridge without support for the
watermark leaves scanning unavailable. Existing scan records are kept. Only
the reader's live-scan handler starts photo capture.

## Commissioning restrictions since 84c63a1

- The actuation profile adds explicit confirmations for OPEN-only wiring and
  an independent hardware stop, plus verified HTTPS ingress and its server-side
  proxy credential. Limit, stop, approved recovery, initial disarm and the
  stable device path already existed. The old deployment documentation also
  required independent physical verification.
- The serial controller now rejects every CLOSE before serial transmission.
  OPEN requires fresh correlated V2 STATUS, correct motion and transaction
  state, no stop latch, and an inactive target OPEN limit. Older handshakes
  without compatible safety telemetry are insufficient. Recovery now requires
  healthy limit inputs, an idle fresh ESP32 boot and zero prior transactions.
  Connection loss latches the controller until explicit recovery.
- Django responses must carry an eligible session UUID. Legacy sessions,
  malformed UUIDs, prior dispatch entries and unresolved journal history
  cannot start a movement. The trusted ingress and end-to-end expiry checks
  also block unauthenticated, stale and delayed requests. The old clock anchor
  could mistake a normal startup NTP adjustment for a runtime fault.
- The tracked ESP32-S3 program is an OPEN-only bench build, capped at 200
  pulses. Protocol completion cannot verify a loaded shutter's position.
  The GPIO stop depends on the controller and firmware.

## Human-only unattended kiosk deployment

Keep the drivers physically isolated and the effective NFC actuation setting
false for this rollout. Confirm no session transition or password recovery is
in progress. Record the active checkout, virtual environment, Nginx document
root and the active startup mechanism. Use the existing SQLite journal,
serial path, device credentials, Raspberry Pi IP and port. This patch
requires zero database migrations.

The commands below use the recorded checkout. Run them from the Pi console.
Inspect effective units by path and retain local overrides. If the Cabinet
assets are hosted by Nginx, restarting a separate Vite service is unnecessary.

```bash
cd /home/taptrack/tap-track-clean
git rev-parse HEAD
git status --short
systemctl show taptrack-nfc.service taptrack-kiosk.service \
  -p FragmentPath -p DropInPaths -p User -p WorkingDirectory -p EnvironmentFiles
sudo nginx -T 2>/dev/null | awk '$1 ~ /^(listen|server_name|root)$/ {print}'
read -r -p 'Absolute path to the reviewed corrective patch: ' PATCH
git apply --check --whitespace=error-all "$PATCH"
sudo systemctl stop taptrack-kiosk.service taptrack-nfc.service
git apply "$PATCH"
read -r -p 'Verified active Nginx document root: ' NGINX_ROOT
test -d "$NGINX_ROOT" && test -f "$NGINX_ROOT/index.html" || exit 1
cd cabinet
npm ci
npm run build -- --outDir "$NGINX_ROOT"
cd ..
```

Use the active HTTPS Cabinet origin and its existing valid certificate.
The browser's launch URL and readiness probe must be identical and use the
trusted HTTPS origin. Keep the same IP and port for LAN clients. The exact
workflow route uses the Pi's local connection for kiosk access, and retains
existing Basic authentication for off-Pi workflow clients. It continues to
inject the protected server-side token and to check Origin in the bridge.
There is no kiosk password in the browser or its launch configuration.

1. Install the shared access snippet in the existing protected Nginx directory.
   Update the active exact workflow include from
   `cabinet/deploy/nginx-workflow-ingress.conf`. If the active static page
   inherits Basic authentication, include `/etc/taptrack/nginx/kiosk-access.conf`
   at the HTTPS server or static location in place of its old Basic directives.
   Keep the protected workflow as an exact location. Preserve the token include,
   password file and generic routes that strip the proxy fields.
2. Determine which peer source the Pi uses when it connects to its own HTTPS
   origin. Prefer loopback if the certificate already covers the local
   hostname and Nginx accepts that name. When browsing the Pi's existing LAN
   IP from that same Pi, add a literal `allow` for **only its own verified local
   source address** before `deny all` in `/etc/taptrack/nginx/kiosk-access.conf`. This is only
   appropriate for a direct Nginx listener. Do not use forwarded headers to
   determine the peer or route off-Pi traffic through a proxy that makes it
   appear local. Keep explicit host and TLS checks.
3. For systemd-managed Chromium, use the updated unit with its current
   account, display, profile and local drop-ins. A unit wanted by
   graphical.target must not also order itself after graphical.target, which
   can create a startup ordering cycle. Set its After line as shown in the
   updated unit. If a drop-in overrides the
   launch or readiness command, update those commands in the drop-in as well.
   Set only the existing trusted HTTPS page URL in the local kiosk environment
   file. If the desktop autostart is authoritative, use the same trusted page
   URL and retain the updated Chromium flags in that launcher. Use one active
   launcher so both instances do not contend for the Chromium profile.
4. For a Pi running systemd-timesyncd, enable its existing wait-sync unit and
   retain `After=time-sync.target` for the NFC bridge. For a different
   installed NTP daemon, use its existing time-sync gate. A timeout or
   unavailable time source must not be interpreted as synchronization.
   Nginx and Chromium can load the Cabinet page while the bridge is starting.
   The Cabinet retries the station read. The first valid workflow uses the
   new clock anchor. A large runtime step after workflows have started still
   closes ingress until reviewed and restarted.

For the systemd launcher and systemd-timesyncd configuration, the operator
can install just the necessary drop-ins as follows. Preserve any active lines
that supply display, Xauthority, existing browser flags or a profile path.

```bash
if ! sudo test -e /etc/taptrack/nginx/kiosk-access.conf; then
  sudo install -m 0644 cabinet/deploy/nginx-kiosk-access.conf /etc/taptrack/nginx/kiosk-access.conf
fi
sudoedit /etc/taptrack/nginx/kiosk-access.conf
read -r -p 'Active exact workflow config include path: ' WORKFLOW_INCLUDE
sudoedit "$WORKFLOW_INCLUDE"
read -r -p 'Existing trusted HTTPS kiosk page URL: ' KIOSK_URL
case "$KIOSK_URL" in https://*);; *) exit 1;; esac
printf 'TAPTRACK_KIOSK_URL=%s\n' "$KIOSK_URL"
sudoedit /etc/taptrack/kiosk.env
sudo install -d /etc/systemd/system/taptrack-nfc.service.d
printf '[Unit]\nRequires=systemd-time-wait-sync.service\nAfter=systemd-time-wait-sync.service time-sync.target\n' |
  sudo tee /etc/systemd/system/taptrack-nfc.service.d/30-time-sync.conf >/dev/null
sudo systemctl enable systemd-time-wait-sync.service
sudo systemctl edit --full taptrack-kiosk.service
sudo systemctl edit taptrack-kiosk.service
```

In the full unit, replace the kiosk's graphical.target entry on its After
line with display-manager.service. Leave other dependencies and the effective
unit account and working paths in place. In the active workflow location,
replace its existing Basic authentication directives with
`include /etc/taptrack/nginx/kiosk-access.conf;`, leaving the other directives
in place.

Copy the printed TAPTRACK_KIOSK_URL line into the kiosk environment file, preserving any other entries.
Use the following in the kiosk drop-in, carrying over the locally installed
Chromium options and executable as needed.

```ini
[Service]
EnvironmentFile=-/etc/taptrack/kiosk.env
ExecStartPre=
ExecStartPre=/usr/bin/curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 2 --max-time 2 ${TAPTRACK_KIOSK_URL}
ExecStart=
ExecStart=/usr/bin/chromium --kiosk --force-prefers-reduced-motion --app=${TAPTRACK_KIOSK_URL} --no-first-run --no-default-browser-check --disable-session-crashed-bubble --noerrdialogs
Restart=always
```

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemd-analyze verify taptrack-kiosk.service taptrack-nfc.service
curl --noproxy '*' --fail --silent --show-error --output /dev/null "$KIOSK_URL"
sudo systemctl enable taptrack-kiosk.service
sudo systemctl start --no-block taptrack-kiosk.service taptrack-nfc.service
systemctl is-active taptrack-kiosk.service taptrack-nfc.service
curl --fail --silent --show-error http://127.0.0.1:5001/nfc/status
```

With driver power still isolated, approve a controlled reboot test. Verify
that the trusted page loads fullscreen with no Basic login, Chromium reports
reduced motion, the station list recovers after the bridge starts, and a new
session needs a new RFID tap. Verify the controller remains disarmed after
startup, test session resume without dispatch, and test an off-Pi request
without credentials, an invalid Origin, a plaintext request and a direct
bridge request without its token. Check physical power-restoration behavior
under an approved procedure.

## Conditional unloaded one-shot bench path

This mode is separate from Django and the kiosk and makes no change to the
motor journal. It requires the NFC service to be inactive and an interactive
Linux terminal. It checks the same serial device configuration and runs the
existing recovery and safety STATUS checks. Each invocation can issue one
OPEN for one station, with a 30-second final confirmation window and no
retries.

Existing laboratory equipment may satisfy **unloaded bench** isolation if a
qualified reviewer can verify an already-available, suitably rated and
immediately reachable physical disconnect removes power from both drivers
independently of the Pi, ESP32 and GPIO. Confirm de-energization, stored energy
decay, and restart behavior at the actual setup with a safe test and documented
operator procedure. A software-controlled output, mains plug out of reach,
unverified supply control or GPIO input alone does not establish that
requirement. If the lab equipment cannot be verified, leave both drivers
isolated. This candidate does not authorize a loaded shutter test.

Only after the bench reviewer signs off on the unloaded and secured motors,
independent stop, both OPEN limits, GPIO stop, correct 200-pulse firmware and
power/restoration procedure, an authorized operator can run a single
supervised trial from the local console. Use the effective existing NFC
environment file and virtual environment if the installation paths differ.

```bash
sudo systemctl stop taptrack-nfc.service
sudo systemd-run --pty --wait --collect --property=User=taptrack \
  --property=EnvironmentFile=/etc/taptrack/nfc.env \
  /home/taptrack/tap-track-clean/pi_service/.venv/bin/python \
  /home/taptrack/tap-track-clean/pi_service/bench_open.py 'Station 1'
```

Treat an aborted, uncertain or disconnected result as requiring isolation and
review. A second trial requires a separate intentional invocation and fresh
recovery. There is no CLOSE path. Loaded shutter commissioning remains
blocked without verified independent stopping and required travel limits.
