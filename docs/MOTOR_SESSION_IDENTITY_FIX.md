# Phase 1 motor compatibility and UUID dispatch — 27 November 2026

## Verified workspace and root cause

The reviewed patch targets base commit `84c63a162f0f5642a6faa670aa1800f448646b16`
(`full screen cab ui`). Use a separate clean checkout of that commit for validation.

The 18 pre-integration UUID changes were backed up and hash-verified before
work began. The integrated changes use the original Git baseline and the two
matching Phase 1 copies as references. The Phase 1 copies in the workspace
and Downloads remain intact. All source edits are local and uncommitted.

The verified failure mechanism in the baseline source is:

1. `CabinetSession` has a numeric AutoField primary key.
2. The Pi passes `str(session['id'])` to its motor action store.
3. SQLite enforces `UNIQUE(workflow_session, station, operation)` and uses
   `ON CONFLICT ... DO NOTHING`, then retrieves that existing row.
4. A historical terminal row suppresses dispatch. Django's workflow can complete
   while the controller's command method is never called. Previously, reused
   results could also expose historical transmission/completion as a new result.

Thus a reused numeric ID across database histories can collide with the retained
Pi journal. The reported sessions 55/47 and November dates are human-supplied live
evidence; no production database or Pi was accessed to independently re-read them.
Why the numeric sequence was reused was not independently established. The code
path and its reproduction with isolated databases are verified. The fix removes
numeric identity from movement deduplication without deleting history.

## Backend changes and migrations

`session_uuid` is UUIDv4, unique, non-null, and read-only. The numeric primary key,
foreign keys, participants, access logs, timestamps, constraints, and workflows
remain. Normal model saves, queryset updates, bulk updates/upserts, API writes,
and admin forms cannot replace the UUID or the eligibility marker. Privileged
direct SQL remains an administrator responsibility; this is not an authentication
or tamper-proof database boundary.

`motor_dispatch_eligible` distinguishes genuinely new sessions from UUID-backfilled
history. It is read-only/immutable through the same normal application paths:

| Migration | Behavior |
| --- | --- |
| `0051_cabinetsession_identity_fields` | Add nullable UUID and default-false eligibility for existing rows. |
| `0052_backfill_cabinetsession_identity` | Assign a separate UUID per existing row; leave eligibility false and all other fields untouched. Existing non-null identities are not regenerated. |
| `0053_enforce_cabinetsession_identity` | Enforce UUID uniqueness/non-null and callable UUID generation; new sessions default eligible true. |

This staged nullable/backfill/constraint sequence follows
[Django's unique-field migration guidance](https://docs.djangoproject.com/en/6.0/howto/writing-migrations/#migrations-that-add-unique-fields).
Quiesce session writers for the migration window; this is not an unrestricted
rolling deployment. Do not reverse these migrations to erase/recreate identities.

Both fields are exposed by `CabinetSessionSerializer`. Existing API authentication,
device authorization, NFC checks, station rules, and maintenance controls remain.
The already completed maintenance reset of sessions 55/47 must not be repeated.
No maintenance environment flag is changed by this fix.

## Pi identity and legacy handling

Only a validated canonical UUIDv4 plus the exact JSON boolean
`motor_dispatch_eligible: true` permits consideration of a new action. Missing or
malformed UUIDs, missing eligibility from an older backend, and migrated legacy
sessions fail closed before recording a new action or accessing the controller.
Numeric `session.id` remains response context; it is never the new dispatch key.

The original SQLite table, rows, and unique constraint remain. New rows use the
canonical UUID in `workflow_session`. Different new UUIDs can dispatch independently
despite identical historical numeric IDs. The same UUID/station/operation always
deduplicates, even if its reported numeric ID changes. No FAILED, COMPLETED,
DISPATCHED, or UNCERTAIN action is automatically retried.

Historical results now describe the **current request** truthfully:
`dispatch_skipped=true`, `serial_command_sent=false`, no new ACCEPTED frames,
and no new command completion. The recorded outcome/transaction remain available
for audit; full historical responses/transmission evidence stay in SQLite.
An uncertain historical outcome requires safety review/recovery, not replay.

An additive `motor_action_identity_links` table records explicit human-reviewed
links from a UUID/station/operation to an exact numeric legacy action ID. Creating
an action and adding a link use SQLite write transactions to avoid a race.
Conflicting links, missing history, replacement of an existing UUID action, and
in-progress legacy actions fail closed. No original row is rewritten or deleted.

`reconcile_motor_identity.py` defaults to read-only preview. Applying a link needs
an explicit action ID, valid UUID, reviewer/evidence reference, and
`--confirm-no-replay`. It does not enable a legacy backend session, resolve an
uncertain motor position, arm a controller, clear a fault, or transmit a command.
Migrated sessions remain inhibited; after human reconciliation, future physical
work uses a fresh authorized session and the existing physical recovery procedure.

Do not link records just because numeric IDs match: the reported November 11 and
November 26 sessions may be different workflows. Verify UUID, station, dates,
participants, logs, transmission evidence, and physical state. If correspondence
cannot be established, leave the history inhibited and escalate for human review.

## Cabinet appearance and safety preservation

Only the existing `motorDispatchStatus` text formatter changes. No screens, JSX
markup, buttons, typography, icons, assets, CSS, dimensions, animations, transitions,
or responsive rules changed. All 48 other tracked Cabinet files were checked
byte-for-byte against the clone baseline. New regression tests do not render new
production components.

Workflow completion remains separate from motor transmission, acceptance,
completion, and physical position verification. Existing disabled, disconnected,
disarmed, rejected, not-transmitted, accepted-but-unconfirmed, and completed
messages remain; skipped/historical requests get an explicit skipped message.
Inconsistent transmission metadata is reported as unconfirmed, never successful.

Phase 1 covers two NEMA 17 motors, two TB6600 drivers, two OPEN limit switches,
and one emergency-stop input. The preserved OPEN-only sketch has a 200-pulse
bound. This integration changes no firmware or GPIO assignments. The Pi
blocks CLOSE before controller access and records the rejection for eligible
sessions. The controller also rejects direct CLOSE calls before any serial write.
Electronic locks remain outside the bench scope.

The bridge checks correlated V2 HELLO/READY and Phase 1 STATUS/STATE responses.
An already-open target limit prevents movement toward that limit. A limit opening
during motion or a stop abort leaves the action uncertain and requires manual
safety recovery. A stop-latch rejection also disarms the controller. Circuit
feedback cannot prove physical shutter position.

The connection worker uses read-only probes with bounded retry delays. It restores
communication after an interruption while movement stays disarmed, even on
reconnect to a matching device/session. The existing manual confirmation path
alone can arm the controller. It requires a fresh, idle firmware session, a zero
transaction counter, and healthy inputs after physical isolation and ESP32 power
cycling. The reviewed Phase 1 sketch initializes the counter to zero on boot and
updates it when accepting a new transaction number. The worker
never dispatches or replays actions or clears a fault. SQLite keeps the original
UUID claim and records interrupted actions as uncertain.

The checked-in older sketch and pre-extension firmware do not report the required
Phase 1 status frame. With either on the ESP32 the integrated bridge stays
disarmed. The flashed firmware and effective Pi configuration were not inspected
in this local task. Verify the hardware inventory, exact persistent serial
symlink, and compatible status response on the Pi with actuation disabled.

The overlapping serial test originally expected a CLOSE frame. The integrated
test now asserts UUID deduplication for OPEN and zero serial writes for CLOSE.
The status formatter places UUID skip/history handling before current safety
messages. IP settings, bridge routes, systemd templates, and Cabinet JSX/CSS
remain unchanged. The Nginx template strips the internal workflow header from
generic bridge traffic.

## Authenticated Cabinet workflow ingress

All `POST /cabinet/workflow` requests require a credential injected by the
authenticated local reverse proxy, one allowed browser Origin, and a JSON object
body. Inspecting an Origin or the source address alone cannot authenticate a caller.
A participant scan authorizes participation in Django, while the kiosk proxy
authorizes the client issuing a workflow command. The bridge keeps the existing
Django device key server-side. Without the proxy credential, the bridge refuses
workflow writes and still serves NFC scans and workflow reads.

The recorded LAN endpoint is `192.168.1.45:5177`. Keep that address and port
and use HTTPS with a certificate trusted by the kiosk and authorized LAN
clients. Use either an IP subject alternative name or a trusted LAN hostname
that resolves to the same IP. Keep the bridge on `127.0.0.1:5001` and the
Cabinet assets on the existing active document root. The recorded paths are
`/home/taptrack/tap-track-clean/cabinet/dist` and
`/home/taptrack/tap-track/pi_service/nfc_events.sqlite3`. Confirm the active
paths and systemd drop-ins before cutover and preserve the existing SQLite
journal, stable serial device, backend URLs, and other authorized origins.

1. Configure the Cabinet HTTPS server to require kiosk authentication. One
   supported option is Nginx Basic authentication over trusted TLS. Protect the
   Cabinet page so the browser authenticates before sending workflow requests.
   Use an explicit server name and deny unknown hosts on that listener. Keep
   the Cabinet bridge URL same-origin and add the exact HTTPS origin, including
   the port, to the existing NFC origin configuration.
2. Include `cabinet/deploy/nginx-workflow-ingress.conf` inside that server and
   keep the generic bridge route from `cabinet/deploy/nginx.conf`. The exact
   location requires TLS and Basic authentication and overwrites the internal
   token and timing fields. Generic proxy routes strip those fields. Keep
   request buffering on, keep upstream retry and error interception off, and
   avoid evaluating the timing variables early in rewrites or authorization
   rules. Never add this credential to a browser build, a log, or an
   unauthenticated or plaintext route.
3. Generate a fresh 32-byte random token as 64 lowercase hexadecimal
   characters. Put it in `TAPTRACK_CABINET_WORKFLOW_PROXY_TOKEN` in the
   bridge's protected environment file and in the matching fixed
   `proxy_set_header X-TapTrack-Workflow-Authorization` directive in
   `/etc/taptrack/nginx/workflow-proxy-header.conf`. Store the include and
   `/etc/taptrack/nginx/kiosk.htpasswd` outside the checkout so they survive
   reboot. Restrict access to the service identities that need them. The Nginx
   master needs access to its config and TLS key, and the worker needs read
   access to the password file. Preserve the separate existing device-key
   include and its startup ordering.
4. Update the effective Chromium kiosk launch URL and its systemd readiness
   check together. The checked-in unit and desktop launcher still point to
   plain HTTP on port 5177. Use a trusted HTTPS origin and a non-mutating exact
   health endpoint with no proxy headers, or an authenticated HTTPS probe.
   A single listener on the existing address and port cannot serve both the
   old plaintext endpoint and the new TLS endpoint using this configuration.
   Verify automatic kiosk startup, LAN access, and the unchanged full-screen
   layout after a reboot before declaring ingress ready.
5. With driver power isolated and actuation disabled, run the isolated proxy
   test and verify the effective Pi routing, certificates, reboot startup and
   access controls. Check normal scans and workflows and reject forged,
   unauthenticated, expired, plaintext, alternate-host and alternate-path
   requests. Check that direct bridge requests without the internal token
   fail and that disallowed origins remain blocked. Only then set
   `TAPTRACK_CABINET_WORKFLOW_INGRESS_VERIFIED=true`. Any ingress or token
   change calls for revalidation with actuation disabled.

The loopback suite runs a real TLS Nginx process against synthetic HTTP and
serial fixtures. It does not install a service or trust a system certificate.
Run it from an isolated checkout using known local binaries.

```bash
python3 -B cabinet/deploy/test_workflow_ingress_proxy.py --nginx /usr/sbin/nginx --openssl /usr/bin/openssl
```

## OPEN timing and lost responses

The trusted Nginx route stamps request age and forwarding time using
`$request_time` and `$msec` when forwarding a buffered request. Request age
starts at the first HTTP bytes read by Nginx and includes header and body
buffering and authentication. The bridge adds time elapsed since forwarding,
which includes waiting for handler admission. This budget does not restart at
the bridge. Missing, duplicate, invalid, implausible, or expired timing is
rejected before Django. Keep the proxy and bridge on the same host and clock.

A conservative guard subtracts 560 ms from the 10-second ingress budget for
clock deviation, rounding and sampling. A forwarding timestamp over 250 ms
ahead is rejected. The bridge compares wall and monotonic clocks to its boot
sample and latches ingress closed on an observed change greater than 250 ms.
Use stable synchronized host time. After a clock step or a latched clock
fault, isolate driver power, quiesce and drain ingress, verify host time, then
restart and repeat the controlled recovery checks. A realtime clock jump and
return between samples cannot be detected by this scheme. TLS negotiation
before the first HTTP bytes is outside the HTTP request budget.

The remaining budget becomes a local monotonic deadline that covers the
backend response, SQLite claim, locks and serial preparation. Nginx keeps its
15-second response read timeout. The independent OPEN STATUS budget is at
most 500 ms. The controller checks it after the read and uses the earlier
of the STATUS and request deadlines immediately before the first CMD write.
Only the background health worker retries a HELLO handshake. No movement
command is automatically retried or replayed.

Only the bridge's explicit pre-dispatch timeout envelope confirms zero
movement writes. A gateway 408 or 5xx, aborted fetch, missing response or
partially transmitted serial command is unconfirmed. Response delivery does
not change a durable action result. The bridge cannot reliably observe every
browser disconnect, cancel bytes already accepted by the OS or USB device, or
prove shutter position. Inspect and reconcile an uncertain result before any
further OPEN.

## Separate maintenance items

The three-way regression comparison reproduced the administrator creation
form's missing administrator ID field, three NFC enrollment status-contract
assertions, and the separate frontend's two copy assertions and unused
`issuedPin` lint error on the unmodified base. Two Django configuration tests
need a synthetic HTTPS registration URL and the intended child settings
module. The photo viewer and password recovery UI tests also reproduced
5-second timeouts under controlled test-worker delays. Keep these maintenance
items separate from the motor timing release and account for their CI effects.

## Automated validation

| Check | Result |
| --- | --- |
| Django identity, cabinet/device workflow, event, and maintenance regressions | 47 passed |
| UUID migration/history assertions rerun after final timestamp assertion | 6 passed (part of the 47 above) |
| Explicit mocked Pi suite | 143 run: 138 passed, 5 skipped |
| Cabinet Node tests | 23 passed |
| Cabinet Vitest suite | 47 passed across 5 files |
| Django migration/model consistency | No changes detected |
| Changed Cabinet helper/test lint | Passed |
| Cabinet production build | Passed |
| Git whitespace validation | Passed |

Run the five skipped Unix-domain recovery-socket tests on Linux before rollout.
Verify the effective systemd service configuration, service account access to the
serial symlink and SQLite journal, and the Nginx-served asset root on the Pi.
Rehearse migrations 0051–0053 with a populated nonproduction PostgreSQL copy.
Verify legacy eligibility, distinct UUIDs, preserved relationships, old-writer
quiescing, and the reviewed forward recovery procedure.

The Node tests used the process-only test setting
`VITE_DJANGO_SERVER_URL=http://127.0.0.1:8000`; no environment file or real endpoint
was changed.
Django tests use `config.test_settings`, overriding the database to temporary
in-memory SQLite and using temporary filesystem media/local email. The Pi runner
replaces the real serial factory with a function that raises, uses temporary
databases, and explicitly excludes the live handshake diagnostic. No physical
serial device is opened. No production migrations or maintenance resets ran.

Human local validation commands (Python 3.12+ for the pinned Django backend):

```powershell
Set-Location '<review-checkout>'
python -m pip install -r requirements.txt
python backend/manage.py test api.test_cabinet_session_identity api.tests.CabinetDeviceIntegrationTests api.tests.CabinetEventAPITests api.test_reset_cabinet_test_sessions --settings=config.test_settings --noinput
python backend/manage.py makemigrations api --check --dry-run --settings=config.test_settings
python pi_service/run_identity_tests.py
Set-Location cabinet
npm ci
$env:VITE_DJANGO_SERVER_URL = 'http://127.0.0.1:8000'
npm test
Remove-Item Env:VITE_DJANGO_SERVER_URL
npm run build
```

Use a dedicated local test environment. The agent installed pinned dependencies
in the writable workspace only; no system-wide installation or dependency-file
change is part of the patch.

## Complete file list and purpose

| File | Modification |
| --- | --- |
| `backend/api/models.py` | Add immutable UUID/eligibility with model/queryset guards; retain numeric PK. |
| `backend/api/serializers.py` | Expose UUID and eligibility read-only. |
| `backend/api/admin.py` | Show the two identity fields read-only. |
| `backend/api/migrations/0051_cabinetsession_identity_fields.py` | Initial nullable identity/legacy inhibition schema. |
| `backend/api/migrations/0052_backfill_cabinetsession_identity.py` | Distinct per-record UUID backfill without historical edits. |
| `backend/api/migrations/0053_enforce_cabinetsession_identity.py` | Unique/non-null UUID and safe new-session defaults. |
| `backend/api/test_cabinet_session_identity.py` | Model, serializer, admin, migration, relationship/timestamp regression tests. |
| `backend/config/test_settings.py` | Explicit isolated database/media/email settings. |
| `pi_service/workflow_timing.py` | Validate trusted age and forwarding timestamps and derive a monotonic deadline. |
| `pi_service/motor_identity.py` | Canonical UUIDv4 validator shared by dispatch and review tooling. |
| `pi_service/motor_controller.py` | Preserve Phase 1 safety frames, OPEN-only serial commands, communication recovery and UUID result metadata. |
| `pi_service/nfc_service.py` | UUID dispatch and history links, Phase 1 service lifecycle and status, and a pre-serial CLOSE block. |
| `pi_service/reconcile_motor_identity.py` | Human-only read-only preview / no-replay history binding. |
| `pi_service/test_nfc_service.py` | Exercise the UUID workflow through the mocked bench protocol, including interrupted OPEN and zero-write CLOSE. |
| `pi_service/test_motor_identity.py` | Collisions, duplicates, bad UUIDs, legacy inhibition, reconciliation and no-replay tests. |
| `pi_service/run_identity_tests.py` | Run UUID and bench regressions with a serial factory that refuses hardware access. |
| `pi_service/test_motor_controller.py` | Mock Phase 1 STATUS frames and test correlated serial commands. |
| `pi_service/test_motor_connection.py` | Cover both OPEN limits, stop outcomes, protocol validation and reconnect without rearming. |
| `pi_service/deploy/README.md` | Direct Phase 1 upgrades to the coordinated runbook. |
| `cabinet/src/utils/motorDispatchStatus.js` | Combine UUID skip/history status with bench safety and communication messages. |
| `cabinet/src/utils/motorIdentityStatus.test.jsx` | Verify UUID and bench messages without changing UI markup. |
| `cabinet/src/services/nfc/scanResultBridge.js` and its tests | Report OPEN uncertainty after a lost or invalid response. |
| `cabinet/deploy/nginx-workflow-ingress.conf` | Authenticated TLS workflow location with overwritten timing metadata. |
| `cabinet/deploy/test_workflow_ingress_proxy.py` | Real loopback TLS proxy regression with synthetic credentials and fake serial. |
| `cabinet/deploy/nginx.conf` | Strip the internal workflow credential from generic proxy traffic. |
| `docs/MOTOR_SESSION_IDENTITY_FIX.md` | This implementation, validation, rollout, and rollback report. |

## Human-only commit and push

Nothing below was executed by the agent. A human must review all files, choose the
team-approved branch, coordinate the rollout window/Render auto-deploy behavior,
and authorize publication. No branch is created or switched automatically.

```powershell
Set-Location '<review-checkout>'
git status --short --branch
git diff HEAD --check
git diff HEAD
$reviewedPaths = @(
  'backend/api/models.py', 'backend/api/serializers.py', 'backend/api/admin.py',
  'backend/api/migrations/0051_cabinetsession_identity_fields.py',
  'backend/api/migrations/0052_backfill_cabinetsession_identity.py',
  'backend/api/migrations/0053_enforce_cabinetsession_identity.py',
  'backend/api/test_cabinet_session_identity.py', 'backend/config/test_settings.py',
  'pi_service/motor_identity.py', 'pi_service/motor_controller.py', 'pi_service/nfc_service.py',
  'pi_service/reconcile_motor_identity.py', 'pi_service/test_nfc_service.py',
  'pi_service/test_motor_identity.py', 'pi_service/run_identity_tests.py',
  'pi_service/test_motor_controller.py', 'pi_service/test_motor_connection.py',
  'pi_service/deploy/README.md', 'cabinet/deploy/nginx.conf',
  'pi_service/workflow_timing.py', 'cabinet/deploy/nginx-workflow-ingress.conf',
  'cabinet/deploy/test_workflow_ingress_proxy.py',
  'cabinet/src/utils/motorDispatchStatus.js', 'cabinet/src/utils/motorIdentityStatus.test.jsx',
  'cabinet/src/services/nfc/scanResultBridge.js', 'cabinet/src/services/nfc/scanResultBridge.test.jsx',
  'docs/MOTOR_SESSION_IDENTITY_FIX.md'
)
git add -- $reviewedPaths
git diff --cached
git commit -m "fix: use immutable session UUIDs for motor dispatch"
git push origin HEAD
```

Recommended commit message: `fix: use immutable session UUIDs for motor dispatch`.
Do not stage unrelated team changes. Coordinate Render before pushing if its
existing auto-deploy setting would otherwise trigger an uncontrolled rollout.

## Human-only Render rollout and Pi update

1. Isolate motor-driver power, verify stationary/unloaded mechanisms, disable
   actuation using the currently authoritative configuration, and stop every Pi
   motor/NFC service. Preserve all existing configuration/credentials/addresses.
2. Pause Cabinet workflow traffic, including clients outside the Pi. Quiesce
   all old Django session writers before migration 0051 and keep them paused
   through 0053. The old model cannot insert sessions once 0051 takes effect. Take a verified PostgreSQL backup
   using the team's approved Render export/restore process. Test on a nonproduction
   PostgreSQL copy first. Preserve the backend environment and the existing
   session history throughout the cutover.
3. A human publishes the reviewed commit and deploys that exact backend version.
   `render.yaml` runs migration at startup. `render.paid.yaml` runs it in a
   pre-deploy command. Verify which configuration is active and confirm old
   writers are paused before either path runs. Use the reviewed migrations.
4. In the human-controlled Render shell, check `python backend/manage.py showmigrations api`.
   Confirm 0051–0053 applied, historical rows have distinct UUIDs/eligibility false,
   and a newly authorized software session receives a new UUID/eligibility true.
   This confirms software identity only; motors remain disabled/isolated.
5. A human updates the Pi's clean checkout to the reviewed commit, retaining the
   existing virtual environment, NFC database path, URLs, secrets, and UI config.
   Do not delete either project directory or clear/replace the SQLite journal.
   Keep the service stopped until both backend and Pi use the new identity contract.

Pi inspection commands (human only):

```bash
cd /home/taptrack/tap-track-clean
sudo systemctl stop taptrack-nfc.service
sudo systemctl show taptrack-nfc.service -p User -p WorkingDirectory -p ExecStart -p EnvironmentFiles -p DropInPaths
sudo systemctl show taptrack-cabinet.service -p User -p WorkingDirectory -p ExecStart
ls -l /dev/serial/by-id/
git status --short
git log -1 --oneline
git remote -v
```

Stop if the checkout has unreviewed team changes. Have a human apply the approved
commit using the team's update process; no Git update command was run by the agent.
Record the active interpreter, SQLite path, serial symlink, and environment-file
precedence from the installed service and its drop-ins. Keep the actual SQLite
path even if it belongs to a different checkout. Preserve the Pi IP/origin
settings, backend URL, credentials, and Render CORS/CSRF configuration. Review
the effective motor settings, including the two additional bench confirmations.
Record the existing values privately. The checked-in samples and the historical
Phase 1 installer are not part of this upgrade.
With the service stopped, make a consistent SQLite backup (enter the verified path):

```bash
read -r -p 'Verified NFC/motor SQLite database path: ' MOTOR_DB
sudo -u taptrack python3 - "$MOTOR_DB" <<'PY'
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import os, sqlite3, sys
os.umask(0o077)
source = Path(sys.argv[1]).resolve()
if not source.is_file():
    raise SystemExit('Existing database not found; stop rather than create an empty database.')
backup = source.with_name(source.name + '.pre-uuid-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as src:
    with closing(sqlite3.connect(backup)) as dst:
        src.backup(dst)
print(backup)
PY
python3 pi_service/run_identity_tests.py
```

Use the verified live interpreter rather than an unrelated environment if
`python3` is not the service runtime. No new Pi third-party dependency is needed.
The store adds the identity-link table in the existing SQLite database. It
preserves the original rows and keys.

Find the Nginx instance serving the kiosk and read its effective `root` for the
Cabinet virtual host. Use the active unit's `ExecStart` and Nginx configuration,
including any included files or overrides. Confirm the served root contains the
current `index.html`. The static document root and the reviewed Cabinet source can
belong to different checkouts. Keep the existing build-time bridge/API settings
and the same Nginx proxy configuration.

With Cabinet traffic paused, supply the three verified absolute paths in a Bash
shell. Save the previous bundle outside the document root. Build directly to the
active root with stale hashed assets retained for existing browser sessions.

```bash
(
  set -e
  read -r -p 'Reviewed Cabinet source directory: ' CABINET_SRC
  read -r -p 'Active Nginx Cabinet document root: ' CABINET_DOCROOT
  read -r -p 'Existing backup directory outside the document root: ' BACKUP_PARENT
  CABINET_SRC=$(realpath -e -- "$CABINET_SRC")
  CABINET_DOCROOT=$(realpath -e -- "$CABINET_DOCROOT")
  BACKUP_PARENT=$(realpath -e -- "$BACKUP_PARENT")
  test "$CABINET_DOCROOT" != /
  test "$CABINET_DOCROOT" != "$CABINET_SRC"
  test -f "$CABINET_SRC/package-lock.json"
  test -f "$CABINET_DOCROOT/index.html"
  case "$BACKUP_PARENT/" in "$CABINET_DOCROOT/"*) exit 1 ;; esac
  CABINET_BACKUP=$(mktemp -d --tmpdir="$BACKUP_PARENT" cabinet-before-uuid.XXXXXXXX)
  cp -a -- "$CABINET_DOCROOT/." "$CABINET_BACKUP/"
  printf 'Cabinet bundle backup: %s\n' "$CABINET_BACKUP"
  cd "$CABINET_SRC"
  npm ci
  VITE_DJANGO_SERVER_URL=http://127.0.0.1:8000 npm test
  npm run build -- --outDir "$CABINET_DOCROOT" --no-emptyOutDir
  test -f "$CABINET_DOCROOT/index.html"
)
```

With actuation disabled, configure and verify authenticated workflow ingress
using the procedure above. Start the NFC bridge with actuation disabled and
verify the new backend and bridge are paired before resuming workflow traffic. Check the served
Cabinet index against the built file at the verified document root. Use the
actual kiosk URL if it differs from the template. Keep the firmware check
read-only. A compatible bench controller can report communication ready while
disarmed.

```bash
sudo systemctl start taptrack-nfc.service
curl -fsS http://127.0.0.1:5001/nfc/status
curl -fsS http://127.0.0.1:5177/nfc-bridge/nfc/status
sudo journalctl -u taptrack-nfc.service -n 60 --no-pager
```

Keep actuation disabled and motor power isolated for this deployment verification.
Confirm Pi mode/path/key settings in the existing configuration; never copy sample
environment files over live files. An older backend without UUID/eligibility is
expected to produce a safe skipped-dispatch response, not numeric fallback.

For explicit legacy audit, stop the service, retain a backup, and use the verified
service interpreter. Substitute reviewed values; never invent a UUID or infer a
mapping solely from the numeric ID:

```bash
python3 pi_service/reconcile_motor_identity.py --database "$MOTOR_DB" --session-uuid REVIEWED_UUID --action-id REVIEWED_ACTION_ID --review-reference 'Reviewer / evidence reference'
# Only after human reconciliation, optionally bind that exact historical action:
python3 pi_service/reconcile_motor_identity.py --database "$MOTOR_DB" --session-uuid REVIEWED_UUID --action-id REVIEWED_ACTION_ID --review-reference 'Reviewer / evidence reference' --apply --confirm-no-replay
```

## Rollback and remaining physical checks

The safe rollback is to keep motors isolated/actuation disabled and preserve the
new UUID schema and every journal row/link. A human may restore the reviewed
previous Pi/UI source and restore the verified active Cabinet document root from its bundle backup. Keep
the latest SQLite database intact: older Pi code cannot safely deduplicate UUID
history using numeric IDs. Do not resume physical operation on that old Pi version.
Restore the reviewed UUID-aware code or apply a forward fix before re-enabling.

Do not run a database migration back to 0050 or regenerate UUIDs. A full backend
code rollback cannot create sessions because the old model omits required
identity columns. Prefer a forward fix retaining the identity model/serializer.
If a human must restore the whole backend database, that requires a separately
approved maintenance restore of the verified pre-migration backup, preservation
and reconciliation of all post-backup data/journals, and continued physical
inhibition. No automated destructive restore is supplied or executed.

After software rollout, an authorized operator must verify the unloaded OPEN-only
bench wiring, correct station/direction, both OPEN limit inputs, independent
hardware stopping, emergency-stop latch, and existing manual safety recovery.
Do not physically test CLOSE with uninstalled CLOSE hardware. Enable actuation
only after that review; this patch never arms automatically. A supervised fresh
authorized OPEN workflow should transmit once, a duplicate UUID request should
not transmit again, and an uncertain result must require human review. Completion
of a pulse routine still does not verify a physically opened cabinet.

Lost, corrupted, or replaced journals and restored database copies require human
reconciliation. PostgreSQL enforces UUID uniqueness and non-nullness. The Django
application enforces immutability of the UUID and eligibility flag. Privileged
SQL or raw imports can bypass that guard. Changing either value can invalidate
the journal match or make a legacy session eligible. Preserve both values during
maintenance and reconcile any discrepancy with actuation disabled. No claim about physical safety,
position, firmware compatibility, or production rollout is inferred from these
software tests.

**Final change boundary:** only the requested local clone and uncommitted source
changes were created. No Git commit/history rewrite, remote repository update,
production database migration, Render deployment/configuration/environment change,
Raspberry Pi deployment, firmware upload, or physical motor actuation was performed.
