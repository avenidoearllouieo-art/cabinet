"""Human-only history binding. Never authorizes, rearms, or replays movement."""
import argparse
import json
from pathlib import Path
import sqlite3
from contextlib import closing

from motor_identity import canonical_session_uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--session-uuid', required=True, type=canonical_session_uuid)
    parser.add_argument('--action-id', required=True, help='Exact previously reviewed legacy action ID')
    parser.add_argument('--review-reference', required=True, help='Reviewer and reconciliation evidence/reference')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-no-replay', action='store_true')
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error('The existing motor SQLite database must be selected; no new database is created.')
    # Preview is strictly read-only, including on a database from older software.
    with closing(sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute('SELECT * FROM motor_actions WHERE action_id = ?', (args.action_id,)).fetchone()
        if row is None:
            parser.error('Legacy action not found.')
        print(json.dumps({key: row[key] for key in ('action_id', 'workflow_session', 'station', 'operation', 'status')}, indent=2))
    if not args.apply:
        print('Preview only. Review backend identity, station, timestamps, outcome, and physical state before applying.')
        return
    if not args.confirm_no_replay:
        parser.error('--apply requires --confirm-no-replay. This only binds history and never enables an action.')
    from nfc_service import SQLiteScanEventStore
    store = SQLiteScanEventStore(args.database)
    try:
        store.reconcile_legacy_motor_identity(args.session_uuid, args.action_id, args.review_reference)
    except (ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Reconciliation refused: {error}\n')
    print('History bound. Original action/status preserved; no command sent. Legacy backend sessions remain inhibited.')


if __name__ == '__main__':
    main()
