# TapTrack

TapTrack is an NFC-enabled cabinet access and coursework tracking system. It contains a Django REST API, a role-based React dashboard for administrators, instructors, and students, and a standalone touchscreen prototype for Raspberry Pi-style cabinet hardware.

## Prerequisites

- Python 3.12 or newer (3.14 is used in CI)
- Node.js 22.12 or newer
- Git

Local databases, uploaded media, generated exports, dependency folders, and production builds are intentionally excluded from Git.

## Backend setup

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python backend/manage.py migrate
python backend/manage.py runserver
```

The API runs at `http://127.0.0.1:8000`. Development defaults work without environment variables. Production deployments must provide `DJANGO_SECRET_KEY` and should set all values documented in [backend/.env.example](backend/.env.example).

To create the first administrator:

```powershell
python backend/manage.py createsuperuser
```

Authentication uses the account **username**, not the student or instructor ID.

## Dashboard setup

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

The dashboard runs at `http://localhost:5176` and proxies `/api` requests to Django on port 8000.

## Touchscreen prototype

The independent cabinet touchscreen prototype is under `kiosk/`:

```powershell
cd kiosk
npm ci
npm run dev
```

It currently uses local browser storage and simulated NFC scans; it does not operate physical locks.

## Quality checks

Run these before opening a pull request:

```powershell
cd frontend
npm run lint
npm run build

cd ..\kiosk
npm run lint
npm run build

cd ..
python backend/manage.py check
python backend/manage.py makemigrations --check --dry-run
python backend/manage.py test api
git diff --check
```

GitHub Actions runs the same frontend, kiosk, and backend checks for every push and pull request.
