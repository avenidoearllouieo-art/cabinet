from django.conf import settings
from django.db import transaction

from .models import CabinetEvent, CabinetSession


STATIONS = ('Station 1', 'Station 2')
CONFIRMATION_PHRASE = 'RESET STATION 1 AND STATION 2'
MAINTENANCE_REASON = 'One-time stale cabinet UI testing session reset.'


class SessionMaintenanceError(ValueError):
    pass


def ensure_configured_stations():
    missing_stations = set(STATIONS) - set(settings.TAPTRACK_CABINET_STATIONS)
    if missing_stations:
        raise SessionMaintenanceError(
            'The configured Cabinet UI does not include: '
            + ', '.join(sorted(missing_stations))
        )


def get_open_sessions():
    ensure_configured_stations()
    return list(
        CabinetSession.objects.filter(
            station__in=STATIONS,
            status=CabinetSession.StatusChoices.OPEN,
        )
        .prefetch_related('opened_by')
        .order_by('station', 'id')
    )


def parse_session_ids(values):
    if isinstance(values, str):
        values = values.split(',')
    parts = [str(value).strip() for value in values]
    if not parts or any(not part.isdecimal() for part in parts):
        raise SessionMaintenanceError('Session IDs must be a comma-separated list of positive IDs.')
    ids = [int(part) for part in parts]
    if any(session_id < 1 for session_id in ids) or len(ids) != len(set(ids)):
        raise SessionMaintenanceError('Session IDs must contain unique positive IDs.')
    return set(ids)


def reset_open_sessions(session_ids, admin_user):
    ensure_configured_stations()
    selected_ids = set(session_ids)
    if not selected_ids:
        raise SessionMaintenanceError('Select at least one open session to reset.')

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
            raise SessionMaintenanceError(
                'The selected sessions are no longer open for Station 1 or Station 2. '
                'Refresh the preview and review the current sessions.'
            )
        if any(
            session.workflow_state != CabinetSession.WorkflowStateChoices.IDLE
            for session in locked_sessions
        ):
            raise SessionMaintenanceError(
                'A selected session has an active opening or closing workflow. '
                'Verify hardware/workflow state first.'
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

    return sorted(selected_ids)