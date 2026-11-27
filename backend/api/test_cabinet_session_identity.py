import uuid
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import connection, IntegrityError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import RequestFactory, TestCase, TransactionTestCase
from django.utils import timezone

from .admin import CabinetSessionAdmin
from .models import AccessLog, CabinetSession, User
from .serializers import CabinetSessionSerializer


class CabinetIdentityTests(TestCase):
    def session(self, **kwargs):
        return CabinetSession.objects.create(station='Station 1', status='closed', **kwargs)

    def test_distinct_immutable_uuids_preserve_numeric_primary_key(self):
        first, second = self.session(), self.session()
        self.assertIsInstance(first.pk, int)
        self.assertNotEqual(first.session_uuid, second.session_uuid)
        self.assertEqual(first.session_uuid.version, 4)
        self.assertTrue(first.motor_dispatch_eligible)
        identity = first.session_uuid
        first.notes = 'Normal workflow update'
        first.save(update_fields=['notes'])
        first.refresh_from_db()
        self.assertEqual(first.session_uuid, identity)
        first.session_uuid = uuid.uuid4()
        with self.assertRaises(ValidationError):
            first.save()

    def test_normal_queryset_and_bulk_updates_cannot_replace_identity_or_eligibility(self):
        session = self.session()
        for field, value in (('session_uuid', uuid.uuid4()), ('motor_dispatch_eligible', False)):
            with self.subTest(field=field):
                with self.assertRaises(ValidationError):
                    CabinetSession.objects.filter(pk=session.pk).update(**{field: value})
                with self.assertRaises(ValidationError):
                    CabinetSession.objects.bulk_update([session], [field])
                with self.assertRaises(ValidationError):
                    CabinetSession.objects.bulk_create([session], update_conflicts=True, update_fields=[field], unique_fields=['id'])
        replacement = CabinetSession(pk=session.pk, station=session.station)
        with self.assertRaises(ValidationError):
            replacement.save()

    def test_uuid_uniqueness_is_enforced_by_database(self):
        first = self.session()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.session(session_uuid=first.session_uuid)

    def test_serializer_and_admin_expose_identity_read_only(self):
        session = self.session()
        before = session.session_uuid
        serializer = CabinetSessionSerializer(session, data={
            'session_uuid': str(uuid.uuid4()), 'motor_dispatch_eligible': False,
        }, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        session.refresh_from_db()
        self.assertEqual(session.session_uuid, before)
        self.assertTrue(session.motor_dispatch_eligible)
        self.assertEqual(serializer.data['session_uuid'], str(before))
        model_admin = CabinetSessionAdmin(CabinetSession, admin.site)
        for field in ('session_uuid', 'motor_dispatch_eligible'):
            self.assertIn(field, model_admin.get_readonly_fields(RequestFactory().get('/'), session))
            self.assertFalse(CabinetSession._meta.get_field(field).editable)


class CabinetIdentityMigrationTests(TransactionTestCase):
    before = ('api', '0050_alter_user_options')
    after = ('api', '0053_enforce_cabinetsession_identity')

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([self.before])
        apps = executor.loader.project_state([self.before]).apps
        sessions = apps.get_model('api', 'CabinetSession')
        user = apps.get_model('api', 'User').objects.create(username='legacy-participant', role='student')
        self.user_id = user.pk
        self.closed_at = timezone.now()
        self.first = sessions.objects.create(station='Station 1', status='closed', notes='Keep history', closed_at=self.closed_at)
        self.second = sessions.objects.create(station='Station 2', status='open')
        self.first.opened_by.add(user)
        self.first.closed_by.add(user)
        self.opened_at = self.first.opened_at
        self.log_id = apps.get_model('api', 'AccessLog').objects.create(cabinet_session=self.first).pk
        MigrationExecutor(connection).migrate([self.after])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_backfill_is_distinct_and_preserves_history_without_authorizing_motion(self):
        first = CabinetSession.objects.get(pk=self.first.pk)
        second = CabinetSession.objects.get(pk=self.second.pk)
        self.assertNotEqual(first.session_uuid, second.session_uuid)
        self.assertFalse(first.motor_dispatch_eligible)
        self.assertFalse(second.motor_dispatch_eligible)
        self.assertEqual(first.opened_at, self.opened_at)
        self.assertEqual(first.closed_at, self.closed_at)
        self.assertEqual(first.notes, 'Keep history')
        self.assertEqual(list(first.opened_by.values_list('pk', flat=True)), [self.user_id])
        self.assertEqual(list(first.closed_by.values_list('pk', flat=True)), [self.user_id])
        self.assertEqual(AccessLog.objects.get(pk=self.log_id).cabinet_session_id, first.pk)
        new = CabinetSession.objects.create(station='Station 1', status='closed')
        self.assertTrue(new.motor_dispatch_eligible)
        self.assertNotIn(new.session_uuid, (first.session_uuid, second.session_uuid))

    def test_repeated_backfill_does_not_regenerate_existing_identity(self):
        import importlib
        migration = importlib.import_module('api.migrations.0052_backfill_cabinetsession_identity')
        apps = MigrationExecutor(connection).loader.project_state([self.after]).apps
        before = dict(CabinetSession.objects.values_list('pk', 'session_uuid'))
        with connection.schema_editor() as editor:
            migration.assign_legacy_identities(apps, editor)
        self.assertEqual(dict(CabinetSession.objects.values_list('pk', 'session_uuid')), before)
