from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import CabinetEvent, CabinetSession, User


STATIONS = ('Station 1', 'Station 2')
CONFIRMATION_PHRASE = 'RESET STATION 1 AND STATION 2'
MAINTENANCE_REASON = 'One-time stale cabinet UI testing session reset.'


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
        configured_stations = set(settings.TAPTRACK_CABINET_STATIONS)
        missing_stations = set(STATIONS) - configured_stations
        if missing_stations:
            raise CommandError(
                'The configured Cabinet UI does not include: '
                + ', '.join(sorted(missing_stations))
            )

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

        candidates = list(
            CabinetSession.objects.filter(
                station__in=STATIONS,
                status=CabinetSession.StatusChoices.OPEN,
            )
            .prefetch_related('opened_by')
            .order_by('station', 'id')
        )
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

        with transaction.atomic():
            locked_sessions = list(
                CabinetSession.objects.select_for_update()
                .filter(
                    pk__in=selected_ids,
                    station__in=STATIONS,
                    status=CabinetSession.StatusChoices.OPEN,
                )
                .order_by('station', 'id')
            )
            if {session.pk for session in locked_sessions} != selected_ids:
                raise CommandError(
                    'The selected sessions changed since preview. No records were changed; '
                    'run the command again to review the current sessions.'
                )
            if any(
                session.workflow_state != CabinetSession.WorkflowStateChoices.IDLE
                for session in locked_sessions
            ):
                raise CommandError(
                    'A selected session has an active opening or closing workflow. '
                    'No records were changed; verify hardware/workflow state first.'
                )

            for session in locked_sessions:
                session.status = CabinetSession.StatusChoices.CLOSED
                session.workflow_state = CabinetSession.WorkflowStateChoices.IDLE
                session.save(update_fields=['status', 'workflow_state', 'updated_at'])

            CabinetEvent.objects.create(
                user=admin_user,
                event_type=CabinetEvent.EventTypeChoices.MAINTENANCE,
                details={
                    'action': 'stale_test_session_reset',
                    'reason': MAINTENANCE_REASON,
                    'session_ids': sorted(selected_ids),
                    'stations': sorted({session.station for session in locked_sessions}),
                    'door_state': 'unchanged; no hardware confirmation recorded',
                },
            )

        self.stdout.write(
            'Reset session IDs: ' + ', '.join(str(value) for value in sorted(selected_ids))
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
        parts = [part.strip() for part in value.split(',')]
        if not parts or any(not part.isdecimal() for part in parts):
            raise CommandError('--session-ids must be a comma-separated list of positive IDs.')
        ids = [int(part) for part in parts]
        if any(session_id < 1 for session_id in ids) or len(ids) != len(set(ids)):
            raise CommandError('--session-ids must contain unique positive IDs.')
        return set(ids)

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
