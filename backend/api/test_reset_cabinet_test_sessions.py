from io import StringIO

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import AccessLog, CabinetEvent, CabinetSession, User


@override_settings(TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'])
class ResetCabinetTestSessionsCommandTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='cabinet-maintenance-admin',
            email='cabinet-maintenance-admin@example.com',
            password='test-password',
            role=User.RoleChoices.ADMIN,
        )
        self.student = User.objects.create_user(
            username='cabinet-maintenance-student',
            email='cabinet-maintenance-student@example.com',
            password='test-password',
            role=User.RoleChoices.STUDENT,
            student_id='CABINET-MAINTENANCE-001',
        )
        self.session = CabinetSession.objects.create(
            station='Station 2',
            status=CabinetSession.StatusChoices.OPEN,
            workflow_state=CabinetSession.WorkflowStateChoices.IDLE,
            closed_at=None,
        )
        self.session.opened_by.add(self.student)
        self.access_log = AccessLog.objects.create(
            user=self.student,
            cabinet_session=self.session,
            station='Station 2',
            status=AccessLog.AccessStatusChoices.SUCCESS,
            action=AccessLog.AccessActionChoices.OPEN,
        )

    def test_preview_lists_sessions_without_changing_records(self):
        output = StringIO()

        call_command('reset_cabinet_test_sessions', stdout=output)

        self.session.refresh_from_db()
        self.assertIn(f'id={self.session.pk} station=Station 2', output.getvalue())
        self.assertIn('participants=1', output.getvalue())
        self.assertIn('Preview only; no database records were changed.', output.getvalue())
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertTrue(self.session.opened_by.filter(pk=self.student.pk).exists())
        self.assertTrue(AccessLog.objects.filter(pk=self.access_log.pk).exists())
        self.assertFalse(CabinetEvent.objects.exists())

    def test_confirmation_resets_only_session_status_and_appends_audit_event(self):
        output = StringIO()

        call_command(
            'reset_cabinet_test_sessions',
            session_ids=str(self.session.pk),
            admin_user_id=self.admin.pk,
            confirm='RESET STATION 1 AND STATION 2',
            stdout=output,
        )

        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.CLOSED)
        self.assertEqual(self.session.workflow_state, CabinetSession.WorkflowStateChoices.IDLE)
        self.assertIsNone(self.session.closed_at)
        self.assertTrue(self.session.opened_by.filter(pk=self.student.pk).exists())
        self.assertFalse(self.session.closed_by.exists())
        self.assertTrue(AccessLog.objects.filter(pk=self.access_log.pk).exists())
        event = CabinetEvent.objects.get()
        self.assertEqual(event.event_type, CabinetEvent.EventTypeChoices.MAINTENANCE)
        self.assertEqual(event.user, self.admin)
        self.assertEqual(event.details['session_ids'], [self.session.pk])
        self.assertIn('door_state', event.details)
        self.assertIn('Station 1: AVAILABLE', output.getvalue())
        self.assertIn('Station 2: AVAILABLE', output.getvalue())

        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get('/api/cabinet-sessions/station-status/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [(station['station'], station['status']) for station in response.json()['stations']],
            [('Station 1', 'AVAILABLE'), ('Station 2', 'AVAILABLE')],
        )

    def test_session_id_mismatch_is_rejected_without_changes(self):
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command(
                'reset_cabinet_test_sessions',
                session_ids='99999',
                admin_user_id=self.admin.pk,
                confirm='RESET STATION 1 AND STATION 2',
                stdout=output,
            )

        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertFalse(CabinetEvent.objects.exists())

    def test_non_idle_workflow_is_not_reset(self):
        self.session.workflow_state = CabinetSession.WorkflowStateChoices.OPENING
        self.session.save(update_fields=['workflow_state'])
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command(
                'reset_cabinet_test_sessions',
                session_ids=str(self.session.pk),
                admin_user_id=self.admin.pk,
                confirm='RESET STATION 1 AND STATION 2',
                stdout=output,
            )

        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertEqual(self.session.workflow_state, CabinetSession.WorkflowStateChoices.OPENING)
        self.assertFalse(CabinetEvent.objects.exists())
