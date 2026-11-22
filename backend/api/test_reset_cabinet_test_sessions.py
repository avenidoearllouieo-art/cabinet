from io import StringIO

from django.core.management import call_command, CommandError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
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


@override_settings(
    TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    TAPTRACK_CABINET_SESSION_MAINTENANCE_ENABLED=True,
)
class CabinetSessionMaintenanceAdminTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='session-maintenance-superuser',
            email='session-maintenance-superuser@example.com',
            password='test-password',
            role=User.RoleChoices.ADMIN,
            is_staff=True,
            is_superuser=True,
        )
        self.student = User.objects.create_user(
            username='session-maintenance-student',
            email='session-maintenance-student@example.com',
            password='test-password',
            role=User.RoleChoices.STUDENT,
            student_id='SESSION-MAINTENANCE-001',
        )
        self.session = CabinetSession.objects.create(
            station='Station 2',
            status=CabinetSession.StatusChoices.OPEN,
            workflow_state=CabinetSession.WorkflowStateChoices.IDLE,
        )
        self.session.opened_by.add(self.student)
        self.access_log = AccessLog.objects.create(
            user=self.student,
            cabinet_session=self.session,
            station='Station 2',
            status=AccessLog.AccessStatusChoices.SUCCESS,
            action=AccessLog.AccessActionChoices.OPEN,
        )
        self.preview_url = reverse('admin:api_cabinetsession_maintenance_preview')
        self.reset_url = reverse('admin:api_cabinetsession_maintenance_reset')

    @override_settings(TAPTRACK_CABINET_SESSION_MAINTENANCE_ENABLED=False)
    def test_preview_is_disabled_by_default(self):
        self.client.force_login(self.admin)

        response = self.client.get(self.preview_url)

        self.assertEqual(response.status_code, 404)

    def test_preview_requires_authenticated_active_admin_superuser(self):
        self.assertEqual(self.client.get(self.preview_url).status_code, 302)

        instructor = User.objects.create_user(
            username='session-maintenance-instructor',
            email='session-maintenance-instructor@example.com',
            password='test-password',
            role=User.RoleChoices.INSTRUCTOR,
        )
        self.client.force_login(instructor)
        self.assertNotEqual(self.client.get(self.preview_url).status_code, 200)

        staff_admin = User.objects.create_user(
            username='session-maintenance-staff-admin',
            email='session-maintenance-staff-admin@example.com',
            password='test-password',
            role=User.RoleChoices.ADMIN,
            is_staff=True,
        )
        self.client.force_login(staff_admin)
        self.assertEqual(self.client.get(self.preview_url).status_code, 403)

        inactive_superuser = User.objects.create_user(
            username='session-maintenance-inactive-superuser',
            email='session-maintenance-inactive-superuser@example.com',
            password='test-password',
            role=User.RoleChoices.ADMIN,
            is_staff=True,
            is_superuser=True,
            is_active=False,
        )
        self.client.force_login(inactive_superuser)
        self.assertNotEqual(self.client.get(self.preview_url).status_code, 200)

        self.client.force_login(self.admin)
        response = self.client.get(self.preview_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f'value="{self.session.pk}"')
        self.assertContains(response, 'Station 2')
        self.assertContains(response, 'idle')
        self.assertContains(response, '>1</td>')
        self.assertContains(response, 'Station 1: AVAILABLE')
        self.assertContains(response, 'Station 2: OCCUPIED')
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertFalse(CabinetEvent.objects.exists())

    def test_reset_requires_csrf_confirmation_and_explicit_current_session_ids(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.admin)
        csrf_client.get(self.preview_url)
        csrf_token = csrf_client.cookies['csrftoken'].value

        form_data = {
            'session_ids': [str(self.session.pk)],
            'confirmation': 'RESET STATION 1 AND STATION 2',
        }
        self.assertEqual(csrf_client.post(self.reset_url, form_data).status_code, 403)

        invalid_phrase = csrf_client.post(
            self.reset_url,
            {**form_data, 'confirmation': 'RESET'},
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(invalid_phrase.status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertFalse(CabinetEvent.objects.exists())

        unknown_id = csrf_client.post(
            self.reset_url,
            {
                'session_ids': [str(self.session.pk), '999999'],
                'confirmation': 'RESET STATION 1 AND STATION 2',
            },
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(unknown_id.status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertFalse(CabinetEvent.objects.exists())

        response = csrf_client.post(
            self.reset_url,
            form_data,
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f'Reset session IDs: {self.session.pk}')
        self.assertContains(response, 'Station 1: AVAILABLE')
        self.assertContains(response, 'Station 2: AVAILABLE')
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.CLOSED)
        self.assertEqual(self.session.workflow_state, CabinetSession.WorkflowStateChoices.IDLE)
        self.assertIsNone(self.session.closed_at)
        self.assertTrue(self.session.opened_by.filter(pk=self.student.pk).exists())
        self.assertFalse(self.session.closed_by.exists())
        self.assertTrue(AccessLog.objects.filter(pk=self.access_log.pk).exists())

        audit_event = CabinetEvent.objects.get()
        self.assertEqual(audit_event.user, self.admin)
        self.assertIsNotNone(audit_event.timestamp)
        self.assertEqual(audit_event.details['session_ids'], [self.session.pk])
        self.assertEqual(
            audit_event.details['door_state'],
            'unchanged; no hardware confirmation recorded',
        )

    def test_reset_leaves_unselected_open_session_untouched(self):
        unselected_session = CabinetSession.objects.create(
            station='Station 1',
            status=CabinetSession.StatusChoices.OPEN,
            workflow_state=CabinetSession.WorkflowStateChoices.IDLE,
        )
        self.client.force_login(self.admin)

        response = self.client.post(
            self.reset_url,
            {
                'session_ids': [str(self.session.pk)],
                'confirmation': 'RESET STATION 1 AND STATION 2',
            },
        )

        self.assertEqual(response.status_code, 200)
        unselected_session.refresh_from_db()
        self.assertEqual(unselected_session.status, CabinetSession.StatusChoices.OPEN)
        self.assertContains(response, 'Station 1: OCCUPIED')
        self.assertEqual(CabinetEvent.objects.get().details['session_ids'], [self.session.pk])

    def test_opening_workflow_cannot_be_reset(self):
        self.session.workflow_state = CabinetSession.WorkflowStateChoices.OPENING
        self.session.save(update_fields=['workflow_state'])
        self.client.force_login(self.admin)

        response = self.client.post(
            self.reset_url,
            {
                'session_ids': [str(self.session.pk)],
                'confirmation': 'RESET STATION 1 AND STATION 2',
            },
        )

        self.assertEqual(response.status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, CabinetSession.StatusChoices.OPEN)
        self.assertEqual(self.session.workflow_state, CabinetSession.WorkflowStateChoices.OPENING)
        self.assertTrue(AccessLog.objects.filter(pk=self.access_log.pk).exists())
        self.assertFalse(CabinetEvent.objects.exists())
