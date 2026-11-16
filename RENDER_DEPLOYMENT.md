# TapTrack Render Deployment

Only the React `frontend` and Django `backend` are configured as application services. `cabinet`, Raspberry Pi services, and ESP32 firmware are not included.

## Backend

- Root directory: repository root (`.`). Python dependencies are declared in root `requirements.txt`.
- Build command: `bash backend/build.sh`
- Pre-deploy command: `python backend/manage.py migrate --noinput`
- Start command: `mkdir -p "$DJANGO_MEDIA_ROOT" "$DJANGO_FILE_UPLOAD_TEMP_DIR" && gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:$PORT`
- Django settings: `config.settings`
- WSGI application: `config.wsgi:application`

The build script installs the root requirements and runs `collectstatic`. WhiteNoise serves Django static assets. Render terminates TLS; Django trusts `X-Forwarded-Proto`, redirects HTTP to HTTPS, and marks session/CSRF cookies secure when `DEBUG` is false. HSTS is configurable but defaults to zero until the final domain and subdomain policy are verified.

## Frontend

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `frontend/dist` in the Blueprint (the Render Dashboard publish path is `dist` when the service root is `frontend`)
- Required build variable: `VITE_API_BASE_URL=https://<actual-api-host>/api`
- The Blueprint rewrites `/*` to `/index.html` for the existing `BrowserRouter` routes.

The API client already reads `VITE_API_BASE_URL`; with no variable, it defaults to `/api` for local Vite proxy development. JWT storage and request interceptors are unchanged.

## API Environment Variables

The Blueprint generates `DJANGO_SECRET_KEY` and wires `DATABASE_URL` to Render PostgreSQL. Set exact frontend URLs after service creation:

| Variable | Value |
| --- | --- |
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECRET_KEY` | Generated secure value; do not commit it |
| `DATABASE_URL` | Render PostgreSQL internal connection string |
| `DJANGO_ALLOWED_HOSTS` | Optional comma-separated API/custom hostnames; Render's assigned hostname is automatically included |
| `DJANGO_CORS_ALLOWED_ORIGINS` | `https://<actual-frontend-host>` (origin only, no path/trailing slash) |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Same frontend origin with `https://` |
| `DJANGO_MEDIA_ROOT` | `/var/data/media` |
| `DJANGO_FILE_UPLOAD_TEMP_DIR` | `/var/data/tmp` |
| `DJANGO_SECURE_SSL_REDIRECT` | Defaults to `true` when `DEBUG=false` |
| `DJANGO_SECURE_HSTS_SECONDS` | Optional, defaults to `0`; enable after HTTPS/custom-domain verification |
| `DEVICE_API_KEY` | Development mock-mode only; do not use it as a production device key |
| `TAPTRACK_NFC_REGISTRATION_URL_BASE` | `https://<actual-frontend-host>/register` |
| `TAPTRACK_NFC_DEVICE_MAP` | Existing device mapping JSON with actual credentials, as a Render secret if deployed NFC readers need to authenticate |

Render prompts for Blueprint `sync: false` values during initial setup. For an existing Blueprint, add or update those values manually in the dashboard. Production NFC requests match the per-device `api_key` values in `TAPTRACK_NFC_DEVICE_MAP`; the singular `DEVICE_API_KEY` is only checked for development mock-mode requests, which are rejected when `DEBUG` is false.

## Database And Media Preservation

Local development currently uses `backend/db.sqlite3` when `DATABASE_URL` is absent. Render PostgreSQL is a separate empty database: applying migrations creates tables but does not copy existing records. Do not treat `migrate` as a data migration.

1. Back up `backend/db.sqlite3` and the complete `backend/media` directory. Pause writes before a final export.
2. Export the local Django records to a file outside Git:

   ```powershell
   python backend/manage.py dumpdata --natural-foreign --natural-primary --exclude contenttypes --exclude auth.permission --output "$env:TEMP\taptrack-data.json"
   ```

3. Deploy the API and apply migrations to the new PostgreSQL database. Securely transfer the fixture to the running API service and run `python backend/manage.py loaddata taptrack-data.json` from its repository-root shell. Keep the SQLite database unchanged as a rollback source until validation is complete.
4. Transfer `backend/media` contents to `/var/data/media`, preserving relative paths. This preserves activity attachments, submission videos/files, profiles, and other existing uploads referenced by database rows. Render disks are available at runtime, not during build or pre-deploy commands.
5. Compare model/table counts and test logins, activity attachments, submission videos/files, and authorized previews/downloads before cutover.

Fixtures contain records, not uploaded file contents. Both the database import and media transfer are needed. Rehearse this procedure on a staging database; if the live source of truth is not the local SQLite database, use a source-specific backup/restore or ETL process instead.

## Deployment Constraints

The API is configured with a 10 GB persistent disk because current uploads are stored on local filesystem storage and must survive deploys. Render persistent disks require a paid web-service plan, prevent multi-instance scaling, and briefly interrupt service during deploys. Increase disk capacity as video storage grows.

The existing API permits videos up to 500 MB and submissions up to 750 MB combined. Render's ingress and request-duration limits must be validated with a representative large upload before cutover; if the platform limit is lower, direct/chunked object-storage uploads will be needed. That would be a separate architecture change, not part of this deployment preparation.