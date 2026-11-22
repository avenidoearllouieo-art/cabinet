from django.core.management.base import BaseCommand, CommandError

from api.cabinet_session_maintenance import (
    CONFIRMATION_PHRASE,
    STATIONS,
    SessionMaintenanceError,
    ensure_configured_stations,
    get_open_sessions,
    parse_session_ids,
    reset_open_sessions,
)
from api.models import CabinetSession, User


class Command(BaseCommand):
    help = 'Preview and explicitly reset stale test sessions for Station 1 and Station 2.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--session-ids',
            help='Comma-separated session IDs to reset, selected from the preview.',
        )
        parser.add_argument(
            '--admin-user-id',
            type=int,
            help='ID of the administrator performing the reset (required to apply).',
        )
        parser.add_argument(
            '--confirm',
            metavar='PHRASE',
            help=f'Required exact confirmation phrase: "{CONFIRMATION_PHRASE}".',
        )

    def handle(self, *args, **options):
        try:
            ensure_configured_stations()
        except SessionMaintenanceError as exc:
            raise CommandError(str(exc)) from exc

        selected_ids = self._parse_session_ids(options['session_ids'])
        confirm = options['confirm']
        admin_user_id = options['admin_user_id']
        if confirm is not None and confirm != CONFIRMATION_PHRASE:
            raise CommandError(f'Confirmation must exactly match: "{CONFIRMATION_PHRASE}".')
        if confirm is not None and (not selected_ids or admin_user_id is None):
            raise CommandError(
                '--confirm requires --session-ids and --admin-user-id.'
            )
        if confirm is None and admin_user_id is not None:
            raise CommandError('--admin-user-id is only valid when applying a confirmed reset.')

        try:
            candidates = get_open_sessions()
        except SessionMaintenanceError as exc:
            raise CommandError(str(exc)) from exc
        candidate_ids = {session.pk for session in candidates}

        if selected_ids is None:
            selected_ids = candidate_ids
        unknown_ids = selected_ids - candidate_ids
        if unknown_ids:
            raise CommandError(
                'Selected session IDs are not currently open for Station 1 or Station 2: '
                + ', '.join(str(value) for value in sorted(unknown_ids))
            )

        self.stdout.write('Open sessions currently determining station occupancy:')
        if not candidates:
            self.stdout.write('  None')
        for session in candidates:
            selection = 'SELECTED' if session.pk in selected_ids else 'not selected'
            self.stdout.write(
                '  id={0} station={1} state={2} participants={3} opened_at={4} [{5}]'.format(
                    session.pk,
                    session.station,
                    session.workflow_state,
                    session.opened_by.count(),
                    session.opened_at.isoformat(),
                    selection,
                )
            )

        if confirm is None:
            self.stdout.write('Preview only; no database records were changed.')
            if selected_ids:
                self.stdout.write(
                    'To apply after reviewing these IDs, rerun with '
                    '--session-ids {0} --admin-user-id <admin-id> --confirm "{1}".'.format(
                        ','.join(str(value) for value in sorted(selected_ids)),
                        CONFIRMATION_PHRASE,
                    )
                )
            self._write_station_status()
            return

        admin_user = User.objects.filter(
            pk=admin_user_id,
            role=User.RoleChoices.ADMIN,
        ).first()
        if admin_user is None:
            raise CommandError(f'User {admin_user_id} is not an administrator.')

        try:
            reset_ids = reset_open_sessions(selected_ids, admin_user)
        except SessionMaintenanceError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            'Reset session IDs: ' + ', '.join(str(value) for value in reset_ids)
        )
        self.stdout.write(
            'Session status updated only. closed_at, participant links, closed_by, '
            'access logs, and hardware state were left unchanged.'
        )
        self._write_station_status()

    @staticmethod
    def _parse_session_ids(value):
        if value is None:
            return None
        try:
            return parse_session_ids(value)
        except SessionMaintenanceError as exc:
            raise CommandError(str(exc)) from exc

    def _write_station_status(self):
        open_stations = set(
            CabinetSession.objects.filter(
                station__in=STATIONS,
                status=CabinetSession.StatusChoices.OPEN,
            ).values_list('station', flat=True)
        )
        for station in STATIONS:
            status = 'OCCUPIED' if station in open_stations else 'AVAILABLE'
            self.stdout.write(f'{station}: {status}')
