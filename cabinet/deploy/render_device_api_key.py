#!/usr/bin/env python3
"""Create a private Nginx include for the two Cabinet photo read endpoints."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


DEVICE_KEY_PATTERN = re.compile(r'^[A-Za-z0-9_-]{16,256}$')


def read_device_key(environment_file: Path) -> str:
    for raw_line in environment_file.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        if name.strip() != 'DEVICE_API_KEY':
            continue
        key = value.strip().strip('"\'')
        if DEVICE_KEY_PATTERN.fullmatch(key):
            return key
        raise ValueError('DEVICE_API_KEY is missing or is not a valid token.')
    raise ValueError('DEVICE_API_KEY was not found in the service environment file.')


def render_include(environment_file: Path, output_file: Path) -> None:
    device_key = read_device_key(environment_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(
        f'proxy_set_header X-API-Key "{device_key}";\n',
        encoding='ascii',
    )
    os.chmod(output_file, 0o600)


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: render_device_api_key.py ENV_FILE OUTPUT_FILE', file=sys.stderr)
        return 2
    try:
        render_include(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError):
        print('Unable to prepare the private Cabinet photo API proxy credential.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
