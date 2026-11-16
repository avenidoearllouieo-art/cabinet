#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

python -m pip install -r "$REPO_ROOT/requirements.txt"
python "$BACKEND_DIR/manage.py" collectstatic --noinput