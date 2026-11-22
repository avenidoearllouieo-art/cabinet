from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.contrib import admin as django_admin
from django.core import mail
from django.conf import settings
from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings
from django.test import TransactionTestCase
from django.db import connection
from django.db import IntegrityError
from django.db.migrations.executor import MigrationExecutor
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from io import BytesIO
from PIL import Image
import os
import json
import hashlib
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch
from zoneinfo import ZoneInfo

from openpyxl import Workbook, load_workbook

from .admin import AccessLogAdmin
from .models import AccessLog, AccessLogPhoto, ActivityDiscussion, ActivityDiscussionAttachment, CabinetEvent, Notification, Section, User, Activity, ActivityAttachment, Submission, SubmissionAttachment, TemporaryUpload, PasswordResetRequest, PasswordRecoveryAuditEvent, NFCEnrollmentSession, CabinetSession


def register_nfc_with_pin(client, payload):
    if 'id_type' not in payload:
        id_type = payload.get('role', 'student')
        identifier_field = 'student_id' if id_type == 'student' else ('instructor_id' if id_type == 'instructor' else 'administrator_id')
        normalized = {
            'token': payload['token'],
            'id_type': id_type,
            'id_number': payload.get(identifier_field, ''),
            'email': payload.get('email') or User.objects.filter(**{identifier_field: payload.get(identifier_field, '')}).values_list('email', flat=True).first() or 'pending@example.test',
            'username': payload.get('username', ''),
            'password': payload['password'],
            'confirm_password': payload.get('confirm_password', payload['password']),
        }
    else:
        normalized = dict(payload)
        normalized.pop('role', None)
        normalized.pop('student_id', None)
        normalized.pop('instructor_id', None)
        normalized.pop('administrator_id', None)
        identifier_field = 'student_id' if normalized['id_type'] == 'student' else ('instructor_id' if normalized['id_type'] == 'instructor' else 'administrator_id')
        id_type = normalized['id_type']

    role = {
        'student': User.RoleChoices.STUDENT,
        'instructor': User.RoleChoices.INSTRUCTOR,
        'administrator': User.RoleChoices.ADMIN,
    }[id_type]
    identifier = normalized['id_number']
    user = User.objects.filter(role=role, **{identifier_field: identifier}, email__iexact=normalized['email']).first()
    if not user:
        return client.post('/api/cabinet/enrollment/register/', normalized, format='json')
    pin = '1234567890'
    token_digest = hashlib.sha256(normalized['token'].encode('utf-8')).hexdigest()
    enrollment = NFCEnrollmentSession.objects.filter(token_digest=token_digest).first()
    if enrollment:
        enrollment.registration_target_user = user
        enrollment.completion_expires_at = (
            timezone.now() - timedelta(seconds=1)
            if enrollment.is_expired
            else timezone.now() + timedelta(minutes=10)
        )
        if enrollment.status == NFCEnrollmentSession.StatusChoices.PENDING:
            enrollment.save(update_fields=['registration_target_user', 'completion_expires_at'])
    return client.post(
        '/api/cabinet/enrollment/register/',
        {**normalized, 'confirm_password': normalized.get('confirm_password', normalized['password'])},
        format='json',
    )


# Compatibility alias for older test call sites; all calls now use the private-PIN contract.
register_nfc_with_email_code = register_nfc_with_pin


class BackendEnvironmentLoadingTests(SimpleTestCase):
    def test_render_environment_selects_postgresql_and_secure_persistent_media(self):
        environment = os.environ.copy()
        environment.update({
            'DJANGO_DEBUG': 'false',
            'DJANGO_SECRET_KEY': 'render-settings-test-secret',
            'DATABASE_URL': 'postgresql://taptrack:test-password@db.example.com:5432/taptrack',
            'RENDER_EXTERNAL_HOSTNAME': 'taptrack-api.onrender.com',
            'DJANGO_CORS_ALLOWED_ORIGINS': 'https://taptrack-ui.onrender.com',
            'DJANGO_CSRF_TRUSTED_ORIGINS': 'https://taptrack-ui.onrender.com',
            'DJANGO_MEDIA_STORAGE_BACKEND': 's3',
            'AWS_STORAGE_BUCKET_NAME': 'taptrack-test-bucket',
            'AWS_ACCESS_KEY_ID': 'test-access-key',
            'AWS_SECRET_ACCESS_KEY': 'test-secret-key',
            'AWS_S3_REGION_NAME': 'ap-southeast-1',
            'AWS_S3_ENDPOINT_URL': 'https://objects.example.test',
            'DJANGO_MEDIA_ROOT': '/var/data/media',
            'DJANGO_FILE_UPLOAD_TEMP_DIR': '/var/data/tmp',
        })
        script = '''
import json
import sys
sys.path.insert(0, sys.argv[1])
from config import settings
from django.core.files.storage import storages
default_storage = storages['default']
print(json.dumps({
    'debug': settings.DEBUG,
    'secret_key': settings.SECRET_KEY,
    'database_engine': settings.DATABASES['default']['ENGINE'],
    'allowed_hosts': settings.ALLOWED_HOSTS,
    'cors_origins': settings.CORS_ALLOWED_ORIGINS,
    'csrf_origins': settings.CSRF_TRUSTED_ORIGINS,
    'media_root': settings.MEDIA_ROOT.as_posix(),
    'media_storage_backend': settings.MEDIA_STORAGE_BACKEND,
    'default_storage': settings.STORAGES['default']['BACKEND'],
    'storage_bucket': settings.AWS_STORAGE_BUCKET_NAME,
    'storage_endpoint': settings.AWS_S3_ENDPOINT_URL,
    'storage_class': type(default_storage).__name__,
    'storage_is_private': default_storage.default_acl is None and default_storage.querystring_auth,
    'file_upload_temp_dir': settings.FILE_UPLOAD_TEMP_DIR,
    'ssl_redirect': settings.SECURE_SSL_REDIRECT,
    'secure_cookies': settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE,
    'proxy_ssl_header': settings.SECURE_PROXY_SSL_HEADER,
    'static_root': str(settings.STATIC_ROOT),
}))
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(settings.BASE_DIR)],
            cwd=settings.BASE_DIR.parent,
            env=environment,
            capture_output=True,
            check=True,
            text=True,
        )

        configured = json.loads(result.stdout)
        self.assertFalse(configured['debug'])
        self.assertEqual(configured['secret_key'], 'render-settings-test-secret')
        self.assertEqual(configured['database_engine'], 'django.db.backends.postgresql')
        self.assertIn('taptrack-api.onrender.com', configured['allowed_hosts'])
        self.assertEqual(configured['cors_origins'], ['https://taptrack-ui.onrender.com'])
        self.assertEqual(configured['csrf_origins'], ['https://taptrack-ui.onrender.com'])
        self.assertEqual(configured['media_root'], '/var/data/media')
        self.assertEqual(configured['media_storage_backend'], 's3')
        self.assertEqual(configured['default_storage'], 'storages.backends.s3.S3Storage')
        self.assertEqual(configured['storage_bucket'], 'taptrack-test-bucket')
        self.assertEqual(configured['storage_endpoint'], 'https://objects.example.test')
        self.assertEqual(configured['storage_class'], 'S3Storage')
        self.assertTrue(configured['storage_is_private'])
        self.assertEqual(configured['file_upload_temp_dir'], '/var/data/tmp')
        self.assertTrue(configured['ssl_redirect'])
        self.assertTrue(configured['secure_cookies'])
        self.assertEqual(configured['proxy_ssl_header'], ['HTTP_X_FORWARDED_PROTO', 'https'])
        self.assertEqual(configured['static_root'], str(settings.BASE_DIR / 'staticfiles'))

    def test_local_environment_without_database_url_keeps_sqlite(self):
        environment = os.environ.copy()
        for name in (
            'DATABASE_URL',
            'RENDER_EXTERNAL_HOSTNAME',
            'DJANGO_MEDIA_ROOT',
            'DJANGO_FILE_UPLOAD_TEMP_DIR',
            'DJANGO_MEDIA_STORAGE_BACKEND',
            'AWS_STORAGE_BUCKET_NAME',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'AWS_S3_REGION_NAME',
            'AWS_S3_ENDPOINT_URL',
        ):
            environment.pop(name, None)
        environment['DJANGO_DEBUG'] = 'true'
        environment['DJANGO_MEDIA_STORAGE_BACKEND'] = 'filesystem'
        environment['DJANGO_SECRET_KEY'] = 'local-settings-test-secret'
        script = '''
import json
import sys
sys.path.insert(0, sys.argv[1])
from config import settings
print(json.dumps({
    'database_engine': settings.DATABASES['default']['ENGINE'],
    'media_root': str(settings.MEDIA_ROOT),
    'ssl_redirect': settings.SECURE_SSL_REDIRECT,
}))
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(settings.BASE_DIR)],
            cwd=settings.BASE_DIR.parent,
            env=environment,
            capture_output=True,
            check=True,
            text=True,
        )

        configured = json.loads(result.stdout)
        self.assertEqual(configured['database_engine'], 'django.db.backends.sqlite3')
        self.assertEqual(configured['media_root'], str(settings.BASE_DIR / 'media'))
        self.assertFalse(configured['ssl_redirect'])

    def test_missing_tigris_configuration_falls_back_to_filesystem_when_debug_is_false(self):
        environment = os.environ.copy()
        for name in (
            'DJANGO_MEDIA_STORAGE_BACKEND',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'AWS_STORAGE_BUCKET_NAME',
            'AWS_S3_ENDPOINT_URL',
            'AWS_S3_REGION_NAME',
        ):
            environment.pop(name, None)
        environment.update({
            'DJANGO_DEBUG': 'false',
            'DJANGO_SECRET_KEY': 'filesystem-fallback-test-secret',
        })
        script = '''
import json
import sys
sys.path.insert(0, sys.argv[1])
from config import settings
print(json.dumps({
    'media_storage_backend': settings.MEDIA_STORAGE_BACKEND,
    'default_storage': settings.STORAGES['default']['BACKEND'],
}))
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(settings.BASE_DIR)],
            cwd=settings.BASE_DIR.parent,
            env=environment,
            capture_output=True,
            check=True,
            text=True,
        )

        configured = json.loads(result.stdout)
        self.assertEqual(configured['media_storage_backend'], 'filesystem')
        self.assertEqual(configured['default_storage'], 'django.core.files.storage.FileSystemStorage')

    def test_allowed_hosts_are_parsed_from_comma_separated_environment_value(self):
        expected_hosts = ['localhost', '127.0.0.1', '192.168.1.43']
        environment = os.environ.copy()
        environment['DJANGO_ALLOWED_HOSTS'] = ', '.join(expected_hosts)
        environment['DJANGO_DEBUG'] = 'true'
        script = '''
import json
import sys
sys.path.insert(0, sys.argv[1])
from config import settings
print(json.dumps(settings.ALLOWED_HOSTS))
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(settings.BASE_DIR)],
            cwd=settings.BASE_DIR.parent,
            env=environment,
            capture_output=True,
            check=True,
            text=True,
        )

        self.assertEqual(json.loads(result.stdout), expected_hosts)
        self.assertIn('192.168.1.43', json.loads(result.stdout))

    def test_dotenv_loads_from_settings_path_outside_backend_working_directory(self):
        env_file = settings.BASE_DIR / '.env'
        if not env_file.is_file():
            self.skipTest('Local backend/.env is not available.')

        environment = os.environ.copy()
        for name in ('DJANGO_DEBUG', 'DJANGO_SECRET_KEY', 'DEVICE_API_KEY'):
            environment.pop(name, None)

        script = '''
import json
import os
import sys
sys.path.insert(0, sys.argv[1])
from config import settings
raw_debug = os.environ.get('DJANGO_DEBUG', '').strip().lower()
expected_debug = raw_debug in {'1', 'true', 'yes', 'on'}
secret_key = os.environ.get('DJANGO_SECRET_KEY', '')
print(json.dumps({
    'debug_loaded': settings.DEBUG == expected_debug,
    'secret_key_loaded': not secret_key or settings.SECRET_KEY == secret_key,
    'device_key_loaded': bool(os.environ.get('DEVICE_API_KEY')),
}))
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(settings.BASE_DIR)],
            cwd=settings.BASE_DIR.parent,
            env=environment,
            capture_output=True,
            check=True,
            text=True,
        )

        loaded = json.loads(result.stdout)
        self.assertEqual(loaded, {
            'debug_loaded': True,
            'secret_key_loaded': True,
            'device_key_loaded': True,
        })


class InstructorSectionOverviewScopeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='section-overview-instructor',
            email='section-overview-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='OVERVIEW-INST-1',
        )
        self.section_a = Section.objects.create(
            section_name='Overview Section A',
            subject_code='OV-A',
            program='Program A',
            year_level='3',
            academic_year='2026-2027',
            instructor=self.instructor,
        )
        self.section_b = Section.objects.create(
            section_name='Overview Section B',
            subject_code='OV-B',
            program='Program B',
            year_level='2',
            academic_year='2026-2027',
        )
        self.section_b.assigned_instructors.add(self.instructor)
        self.student_a = User.objects.create_user(
            username='overview-student-a',
            email='overview-student-a@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='OV-STU-A',
            nfc_uid='OVERVIEW-NFC-A',
            section=self.section_a,
        )
        self.student_b = User.objects.create_user(
            username='overview-student-b',
            email='overview-student-b@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='OV-STU-B',
            section=self.section_b,
        )
        self.student_b_missing = User.objects.create_user(
            username='overview-student-b-missing',
            email='overview-student-b-missing@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='OV-STU-B-MISSING',
            section=self.section_b,
        )
        self.activity_a = Activity.objects.create(
            title='Section A activity',
            created_by=self.instructor,
            cabinet_station='Cabinet Station 1',
        )
        self.activity_a.assigned_sections.add(self.section_a)
        self.activity_b = Activity.objects.create(
            title='Section B activity',
            created_by=self.instructor,
            cabinet_station='Cabinet Station 2',
        )
        self.activity_b.assigned_sections.add(self.section_b)
        Submission.objects.create(activity=self.activity_a, student=self.student_a)
        Submission.objects.create(activity=self.activity_b, student=self.student_b)
        AccessLog.objects.create(user=self.student_a, station='Cabinet Station 1', status='success')
        AccessLog.objects.create(user=self.student_b, station='Cabinet Station 2', status='failed')
        self.client.force_authenticate(user=self.instructor)

    def test_section_overview_contains_only_selected_sections_records(self):
        response = self.client.get(f'/api/sections/{self.section_a.pk}/overview/')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertEqual(payload['section']['section_id'], self.section_a.pk)
        self.assertEqual(payload['counts'], {
            'students': 1,
            'activities': 1,
            'submitted': 1,
            'expected': 1,
            'missing': 0,
            'late': 0,
            'pending_review': 1,
        })
        self.assertEqual({student['id'] for student in payload['students']}, {self.student_a.pk})
        self.assertTrue(payload['students'][0]['nfc_registered'])
        self.assertNotIn('nfc_uid', payload['students'][0])
        self.assertEqual({activity['id'] for activity in payload['activities']}, {self.activity_a.pk})
        self.assertEqual({item['id'] for item in payload['recent_submissions']}, {self.student_a.submissions.get().pk})
        self.assertEqual({log['user'] for log in payload['access_logs']}, {self.student_a.pk})
        self.assertTrue(all('nfc_uid' not in log for log in payload['access_logs']))
        self.assertEqual(payload['cabinet_stations'], [{'station': 'Cabinet Station 1', 'status': 'Available'}])

    def test_assigned_sections_and_section_list_metrics_respect_selected_section(self):
        response = self.client.get('/api/sections/')

        self.assertEqual(response.status_code, 200, response.json())
        sections = response.json()['results']
        self.assertEqual({section['section_id'] for section in sections}, {self.section_a.pk, self.section_b.pk})
        by_id = {section['section_id']: section for section in sections}
        self.assertEqual(by_id[self.section_a.pk]['student_count'], 1)
        self.assertEqual(by_id[self.section_a.pk]['activity_count'], 1)
        self.assertEqual(by_id[self.section_a.pk]['submitted_count'], 1)
        self.assertEqual(by_id[self.section_a.pk]['missing_count'], 0)
        self.assertEqual(by_id[self.section_a.pk]['cabinet_station'], 'Cabinet Station 1')
        self.assertEqual(by_id[self.section_b.pk]['student_count'], 2)
        self.assertEqual(
            by_id[self.section_b.pk]['instructor_name'],
            self.instructor.get_full_name().strip() or self.instructor.username,
        )
        self.assertEqual(by_id[self.section_b.pk]['activity_count'], 1)
        self.assertEqual(by_id[self.section_b.pk]['submitted_count'], 1)
        self.assertEqual(by_id[self.section_b.pk]['expected_submission_count'], 2)
        self.assertEqual(by_id[self.section_b.pk]['missing_count'], 1)
        self.assertEqual(by_id[self.section_b.pk]['cabinet_station'], 'Cabinet Station 2')

        students_response = self.client.get(f'/api/users/?section={self.section_b.pk}&role=student')
        self.assertEqual(students_response.status_code, 200, students_response.json())
        self.assertEqual(
            {student['id'] for student in students_response.json()['results']},
            {self.student_b.pk, self.student_b_missing.pk},
        )

    def test_admin_section_directory_reports_actual_students_and_activities(self):
        admin_user = User.objects.create_user(
            username='section-directory-admin',
            email='section-directory-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin_user)

        response = self.client.get('/api/sections/')

        self.assertEqual(response.status_code, 200, response.json())
        sections = {item['section_id']: item for item in response.json()['results']}
        self.assertEqual(sections[self.section_a.pk]['student_count'], 1)
        self.assertEqual(sections[self.section_a.pk].get('activity_count'), 1, sections[self.section_a.pk])
        self.assertEqual(sections[self.section_b.pk]['student_count'], 2)
        self.assertEqual(sections[self.section_b.pk]['activity_count'], 1)
        self.assertEqual(sections[self.section_b.pk]['instructor'], self.instructor.pk)
        self.assertEqual(sections[self.section_b.pk]['instructor_name'], self.instructor.get_full_name().strip() or self.instructor.username)

    def test_section_destination_endpoints_are_scoped_to_selected_section(self):
        activities_response = self.client.get(f'/api/activities/?section={self.section_a.pk}')
        submissions_response = self.client.get(f'/api/submissions/?section={self.section_a.pk}')
        logs_response = self.client.get(f'/api/access-logs/?user__section={self.section_a.pk}')
        stats_response = self.client.get(f'/api/access-logs/stats/?user__section={self.section_a.pk}')

        self.assertEqual(activities_response.status_code, 200, activities_response.json())
        self.assertEqual(submissions_response.status_code, 200, submissions_response.json())
        self.assertEqual(logs_response.status_code, 200, logs_response.json())
        self.assertEqual(stats_response.status_code, 200, stats_response.json())
        self.assertEqual({activity['id'] for activity in activities_response.json()['results']}, {self.activity_a.pk})
        self.assertEqual({submission['id'] for submission in submissions_response.json()['results']}, {self.student_a.submissions.get().pk})
        self.assertEqual({log['user'] for log in logs_response.json()['results']}, {self.student_a.pk})
        self.assertEqual(stats_response.json()['total_accesses_today'], 1)

    def test_instructor_cannot_open_an_unassigned_section_overview(self):
        other = User.objects.create_user(
            username='other-section-instructor',
            email='other-section-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='OVERVIEW-INST-2',
        )
        other_section = Section.objects.create(section_name='Other Section', instructor=other)

        response = self.client.get(f'/api/sections/{other_section.pk}/overview/')

        self.assertEqual(response.status_code, 404)


class InstructorSectionAssignmentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='api-admin',
            email='api-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.first_instructor = User.objects.create_user(
            username='first-instructor',
            email='first-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='INST-001',
        )
        self.second_instructor = User.objects.create_user(
            username='second-instructor',
            email='second-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='INST-002',
        )
        self.section_a = Section.objects.create(section_name='API Section A', subject_code='API-A')
        self.section_b = Section.objects.create(section_name='API Section B', subject_code='API-B')
        self.client.force_authenticate(user=self.admin)

    def test_pending_profile_has_no_registration_pin_requirement(self):
        pending = User.objects.create_user(
            username='pending-no-pin',
            email='pending-no-pin@example.com',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='NO-PIN-TEST-001',
            nfc_uid='NO-PIN-CARD',
        )
        pending.set_unusable_password()
        pending.save(update_fields=['password'])
        response = self.client.post(f'/api/users/{pending.pk}/registration-pin/', {}, format='json')
        self.assertIn(response.status_code, (404, 405))
        pending.refresh_from_db()
        self.assertFalse(pending.registration_pin_hash)

    def test_create_instructor_accepts_ids_and_returns_section_objects(self):
        response = self.client.post('/api/users/', {
            'email': 'created-instructor@example.com',
            'role': User.RoleChoices.INSTRUCTOR,
            'instructor_id': 'INST-003',
            'assigned_sections': [self.section_a.pk, self.section_b.pk],
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        created = User.objects.get(instructor_id='INST-003')
        self.assertIsNone(response.json()['username'])
        self.assertNotIn('password', response.json())
        self.assertFalse(created.has_usable_password())
        self.assertEqual(
            {item['section_id'] for item in response.json()['assigned_sections']},
            {self.section_a.pk, self.section_b.pk},
        )
        self.assertEqual(set(created.assigned_sections.values_list('pk', flat=True)), {self.section_a.pk, self.section_b.pk})
        self.assertFalse(Section.objects.filter(pk__in=[self.section_a.pk, self.section_b.pk]).exclude(instructor=created).exists())

    def test_admin_can_create_student_without_credentials_but_not_admin_profiles_through_this_api(self):
        student_response = self.client.post('/api/users/', {
            'email': 'created-student@example.com',
            'first_name': 'Created',
            'last_name': 'Student',
            'role': User.RoleChoices.STUDENT,
            'student_id': 'ST-NEW-001',
            'section': self.section_a.pk,
        }, format='json')
        admin_response = self.client.post('/api/users/', {
            'username': 'created-admin',
            'email': 'created-admin@example.com',
            'password': 'secret1234',
            'first_name': 'Created',
            'last_name': 'Admin',
            'role': User.RoleChoices.ADMIN,
        }, format='json')
        invalid_response = self.client.post('/api/users/', {
            'username': 'invalid-role-user',
            'email': 'invalid-role-user@example.com',
            'password': 'secret1234',
            'role': 'administrator-with-invalid-value',
        }, format='json')

        self.assertEqual(student_response.status_code, 201, student_response.json())
        self.assertEqual(invalid_response.status_code, 400, invalid_response.json())
        self.assertIsNone(student_response.json()['username'])
        self.assertNotIn('password', student_response.json())
        student = User.objects.get(student_id='ST-NEW-001')
        self.assertFalse(student.has_usable_password())
        self.assertEqual(student_response.json()['registration_status'], 'pending_registration')
        self.assertEqual(admin_response.status_code, 400, admin_response.json())
        self.assertFalse(User.objects.filter(email='created-admin@example.com').exists())
        self.assertTrue(User.objects.filter(pk=self.first_instructor.pk).exists())

    def test_pending_profile_cannot_authenticate_until_registration(self):
        response = self.client.post('/api/users/', {
            'email': 'pending-login@example.com',
            'first_name': 'Pending',
            'last_name': 'Login',
            'role': User.RoleChoices.STUDENT,
            'student_id': 'ST-PENDING-LOGIN',
            'section': self.section_a.pk,
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        pending = User.objects.get(student_id='ST-PENDING-LOGIN')
        self.assertFalse(pending.has_usable_password())
        login = APIClient().post('/api/auth/login/', {
            'username': pending.username,
            'password': 'AnyAttemptedPassword!123',
        }, format='json')
        self.assertEqual(login.status_code, 401, login.json())

    def test_assignment_transfer_removes_previous_owner(self):
        self.first_instructor.assigned_sections.add(self.section_a)
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])

        response = self.client.patch(f'/api/users/{self.second_instructor.pk}/', {
            'assigned_sections': [self.section_a.pk],
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.section_a.refresh_from_db()
        self.assertEqual(self.section_a.instructor, self.second_instructor)
        self.assertFalse(self.first_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())
        self.assertTrue(self.second_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())

    def test_replacing_and_clearing_assignments_updates_both_relationships(self):
        self.first_instructor.assigned_sections.add(self.section_a)
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])

        response = self.client.patch(f'/api/users/{self.first_instructor.pk}/', {
            'assigned_sections': [self.section_b.pk],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.json())
        self.section_a.refresh_from_db()
        self.section_b.refresh_from_db()
        self.assertIsNone(self.section_a.instructor)
        self.assertEqual(self.section_b.instructor, self.first_instructor)

        response = self.client.patch(f'/api/users/{self.first_instructor.pk}/', {
            'assigned_sections': [],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.json())
        self.section_b.refresh_from_db()
        self.assertIsNone(self.section_b.instructor)
        self.assertFalse(self.first_instructor.assigned_sections.exists())

    def test_role_change_clears_instructor_assignments(self):
        self.admin.is_staff = True
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_staff', 'is_superuser'])
        self.first_instructor.assigned_sections.add(self.section_a)
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])

        response = self.client.patch(f'/api/users/{self.first_instructor.pk}/', {
            'role': User.RoleChoices.ADMIN,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.section_a.refresh_from_db()
        self.first_instructor.refresh_from_db()
        self.assertIsNone(self.section_a.instructor)
        self.assertFalse(self.first_instructor.assigned_sections.exists())
        self.assertEqual(response.json()['assigned_sections'], [])

    def test_section_endpoint_keeps_assignment_relationships_in_sync(self):
        response = self.client.patch(f'/api/sections/{self.section_a.pk}/', {
            'instructor': self.first_instructor.pk,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(self.first_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())

        response = self.client.patch(f'/api/sections/{self.section_a.pk}/', {
            'instructor': self.second_instructor.pk,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.json())
        self.assertFalse(self.first_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())
        self.assertTrue(self.second_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())

    def test_section_create_and_edit_do_not_require_program_or_overwrite_legacy_value(self):
        self.section_a.program = 'BSCS'
        self.section_a.save(update_fields=['program'])

        created = self.client.post('/api/sections/', {
            'section_name': 'Program-free section',
            'year_level': '2nd Year',
            'academic_year': '2026–2027',
        }, format='json')
        updated = self.client.patch(f'/api/sections/{self.section_a.pk}/', {
            'academic_year': '2027–2028',
        }, format='json')

        self.assertEqual(created.status_code, 201, created.json())
        self.assertEqual(created.json()['program'], '')
        self.assertEqual(created.json()['academic_year'], '2026–2027')
        self.assertEqual(updated.status_code, 200, updated.json())
        self.section_a.refresh_from_db()
        self.assertEqual(self.section_a.program, 'BSCS')
        self.assertEqual(self.section_a.academic_year, '2027–2028')

    def test_bulk_section_assignment_updates_owner_relationships(self):
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])
        self.first_instructor.assigned_sections.add(self.section_a)

        response = self.client.patch('/api/sections/assign-instructor/', {
            'section_ids': [self.section_a.pk, self.section_b.pk],
            'instructor_id': self.second_instructor.pk,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.section_a.refresh_from_db()
        self.section_b.refresh_from_db()
        self.assertEqual(self.section_a.instructor, self.second_instructor)
        self.assertEqual(self.section_b.instructor, self.second_instructor)
        self.assertFalse(self.first_instructor.assigned_sections.filter(pk=self.section_a.pk).exists())
        self.assertEqual(self.second_instructor.assigned_sections.count(), 2)

    def test_bulk_section_assignment_is_atomic_when_a_section_is_missing(self):
        response = self.client.patch('/api/sections/assign-instructor/', {
            'section_ids': [self.section_a.pk, 999999],
            'instructor_id': self.second_instructor.pk,
        }, format='json')

        self.assertEqual(response.status_code, 404, response.json())
        self.section_a.refresh_from_db()
        self.assertIsNone(self.section_a.instructor)

    def test_bulk_section_assignment_rejects_inactive_instructors(self):
        self.second_instructor.is_active = False
        self.second_instructor.save(update_fields=['is_active'])

        response = self.client.patch('/api/sections/assign-instructor/', {
            'section_ids': [self.section_a.pk],
            'instructor_id': self.second_instructor.pk,
        }, format='json')

        self.assertEqual(response.status_code, 400, response.json())
        self.assertIn('registered instructor', ' '.join(response.json()['instructor_id']))
        self.section_a.refresh_from_db()
        self.assertIsNone(self.section_a.instructor)

    def test_bulk_section_assignment_requires_admin(self):
        self.client.force_authenticate(user=self.first_instructor)

        response = self.client.patch('/api/sections/assign-instructor/', {
            'section_ids': [self.section_a.pk],
            'instructor_id': self.second_instructor.pk,
        }, format='json')

        self.assertEqual(response.status_code, 403)
        self.section_a.refresh_from_db()
        self.assertIsNone(self.section_a.instructor)

    def test_legacy_section_owner_is_included_in_user_response(self):
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])

        response = self.client.get(f'/api/users/{self.first_instructor.pk}/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(
            [item['section_id'] for item in response.json()['assigned_sections']],
            [self.section_a.pk],
        )


class ActivityDiscussionAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='discussion-instructor',
            email='discussion-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='DISCUSSION-001',
        )
        self.assigned_instructor = User.objects.create_user(
            username='discussion-assigned-instructor',
            email='discussion-assigned@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='DISCUSSION-002',
        )
        self.other_instructor = User.objects.create_user(
            username='discussion-other-instructor',
            email='discussion-other@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='DISCUSSION-003',
        )
        self.section = Section.objects.create(section_name='Discussion Section', instructor=self.instructor)
        self.section.assigned_instructors.add(self.assigned_instructor)
        self.student = User.objects.create_user(
            username='discussion-student',
            email='discussion-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='DISCUSSION-STUDENT-001',
            section=self.section,
        )
        self.owned_activity = Activity.objects.create(
            title='Owned discussion activity',
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        self.assigned_activity = Activity.objects.create(
            title='Assigned discussion activity',
            created_by=self.other_instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        self.assigned_activity.assigned_sections.add(self.section)
        self.unrelated_activity = Activity.objects.create(
            title='Unrelated discussion activity',
            created_by=self.other_instructor,
        )

    def test_instructor_can_create_discussion_attachment_for_owned_activity(self):
        self.client.force_authenticate(user=self.instructor)
        attachment = SimpleUploadedFile('brief.pdf', b'%PDF-1.4\nbrief', content_type='application/pdf')

        response = self.client.post('/api/activity-discussions/', {
            'activity': self.owned_activity.pk,
            'message': 'Review the attached brief.',
            'attachment': attachment,
        }, format='multipart')

        self.assertEqual(response.status_code, 201, response.json())
        discussion = ActivityDiscussion.objects.get(pk=response.json()['id'])
        stored_attachment = ActivityDiscussionAttachment.objects.get(discussion=discussion)
        self.assertEqual(stored_attachment.original_filename, 'brief.pdf')
        self.assertEqual(response.json()['attachments'][0]['filename'], 'brief.pdf')
        self.assertEqual(response.json()['sender'], self.instructor.pk)

        appended_file = SimpleUploadedFile('appendix.pdf', b'%PDF-1.4\nappendix', content_type='application/pdf')
        edit_response = self.client.patch(
            f"/api/activity-discussions/{discussion.pk}/",
            {'message': 'Updated with an appendix.', 'attachment': appended_file},
            format='multipart',
        )
        self.assertEqual(edit_response.status_code, 200, edit_response.json())
        self.assertEqual(len(edit_response.json()['attachments']), 2)
        self.assertEqual(discussion.attachments.count(), 2)

    def test_assigned_instructor_can_view_and_post_but_not_access_unrelated_discussions(self):
        assigned_message = ActivityDiscussion.objects.create(
            activity=self.assigned_activity,
            sender=self.instructor,
            sender_role=User.RoleChoices.INSTRUCTOR,
            message='Assigned activity thread.',
        )
        unrelated_message = ActivityDiscussion.objects.create(
            activity=self.unrelated_activity,
            sender=self.other_instructor,
            sender_role=User.RoleChoices.INSTRUCTOR,
            message='Private to another instructor.',
        )
        self.client.force_authenticate(user=self.assigned_instructor)

        list_response = self.client.get('/api/activity-discussions/')
        create_response = self.client.post('/api/activity-discussions/', {
            'activity': self.assigned_activity.pk,
            'message': 'I can access this assigned activity.',
        }, format='json')
        forbidden_response = self.client.post('/api/activity-discussions/', {
            'activity': self.unrelated_activity.pk,
            'message': 'This must be rejected.',
        }, format='json')
        hidden_detail = self.client.get(f'/api/activity-discussions/{unrelated_message.pk}/')

        self.assertEqual(list_response.status_code, 200, list_response.json())
        self.assertEqual({item['id'] for item in list_response.json()['results']}, {assigned_message.pk})
        self.assertEqual(create_response.status_code, 201, create_response.json())
        self.assertEqual(forbidden_response.status_code, 403)
        self.assertEqual(hidden_detail.status_code, 404)

        assigned_message = ActivityDiscussion.objects.get(pk=assigned_message.pk)
        move_response = self.client.patch(
            f'/api/activity-discussions/{assigned_message.pk}/',
            {'activity': self.unrelated_activity.pk},
            format='json',
        )
        self.assertEqual(move_response.status_code, 403)
        assigned_message.refresh_from_db()
        self.assertEqual(assigned_message.activity_id, self.assigned_activity.pk)

    def test_student_discussion_scope_is_limited_to_their_section(self):
        student_activity = Activity.objects.create(
            title='Student section discussion activity',
            section=self.section,
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        visible = ActivityDiscussion.objects.create(
            activity=student_activity,
            sender=self.student,
            sender_role=User.RoleChoices.STUDENT,
            message='Visible section post.',
        )
        assigned_activity = Activity.objects.create(
            title='M2M assigned discussion activity',
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        assigned_activity.assigned_sections.add(self.section)
        assigned_visible = ActivityDiscussion.objects.create(
            activity=assigned_activity,
            sender=self.instructor,
            sender_role=User.RoleChoices.INSTRUCTOR,
            message='Visible through assigned sections.',
        )
        ActivityDiscussion.objects.create(
            activity=self.unrelated_activity,
            sender=self.other_instructor,
            sender_role=User.RoleChoices.INSTRUCTOR,
            message='Unrelated post.',
        )
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/activity-discussions/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual({item['id'] for item in response.json()['results']}, {visible.pk, assigned_visible.pk})


class ActivityCreationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='instructor1',
            email='instructor1@example.com',
            password='secret123',
            role='instructor',
            first_name='Instructor',
            last_name='One',
            instructor_id='I001',
            nfc_uid='NFC-INST-001',
        )
        self.section_a = Section.objects.create(section_name='Section A', subject_code='SEC-A', instructor=self.instructor)
        self.section_b = Section.objects.create(section_name='Section B', subject_code='SEC-B', instructor=self.instructor)
        self.other_instructor = User.objects.create_user(
            username='instructor2',
            email='instructor2@example.com',
            password='secret123',
            role='instructor',
            instructor_id='I002',
            nfc_uid='NFC-INST-002',
        )

    def test_admin_cannot_create_update_or_delete_activities(self):
        admin_user = User.objects.create_user(
            username='activity-admin',
            email='activity-admin@example.com',
            password='secret123',
            role=User.RoleChoices.ADMIN,
        )
        activity = Activity.objects.create(title='Instructor-owned activity', created_by=self.instructor)
        self.client.force_authenticate(user=admin_user)

        create_response = self.client.post('/api/activities/', {'title': 'Admin-created activity'}, format='json')
        update_response = self.client.patch(f'/api/activities/{activity.pk}/', {'title': 'Admin-edited activity'}, format='json')
        delete_response = self.client.delete(f'/api/activities/{activity.pk}/')

        self.assertEqual(create_response.status_code, 403)
        self.assertEqual(update_response.status_code, 403)
        self.assertEqual(delete_response.status_code, 403)
        activity.refresh_from_db()
        self.assertEqual(activity.title, 'Instructor-owned activity')
        self.assertEqual(Activity.objects.count(), 1)

    def test_django_superuser_can_maintain_activities(self):
        superuser = User.objects.create_superuser(
            username='activity-superuser',
            email='activity-superuser@example.com',
            password='secret123',
        )
        activity = Activity.objects.create(title='Maintenance activity', created_by=self.instructor)
        self.client.force_authenticate(user=superuser)

        response = self.client.patch(f'/api/activities/{activity.pk}/', {'title': 'Maintained activity'}, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        activity.refresh_from_db()
        self.assertEqual(activity.title, 'Maintained activity')

    def test_instructor_can_create_activity_with_extended_fields(self):
        self.client.force_authenticate(user=self.instructor)

        payload = {
            'title': 'Extended Activity',
            'description': 'A richer activity form payload.',
            'instructions': '<p>Read the brief carefully.</p>',
            'activity_type': 'Assignment',
            'assigned_sections': [self.section_a.section_id, self.section_b.section_id],
            'assigned_instructor': self.instructor.id,
            'due_date': '2026-08-10T09:00:00Z',
            'max_score': 100,
            'cabinet_station': 'Cabinet 1',
            'status': 'Draft',
        }

        response = self.client.post('/api/activities/', payload, format='json')

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data['title'], 'Extended Activity')
        self.assertEqual(data['activity_type'], 'Assignment')
        self.assertEqual(data['status'], 'Draft')
        self.assertEqual(data['cabinet_station'], 'Cabinet 1')
        self.assertEqual(data['assigned_instructor'], self.instructor.id)
        self.assertEqual(set(data['assigned_sections']), {self.section_a.section_id, self.section_b.section_id})

        activity = Activity.objects.get(id=data['id'])
        self.assertEqual(activity.created_by, self.instructor)
        self.assertEqual(activity.instructions, '<p>Read the brief carefully.</p>')
        self.assertTrue(activity.assigned_sections.filter(section_id__in=[self.section_a.section_id, self.section_b.section_id]).count() == 2)

    def test_activity_is_created_as_private_draft_until_explicit_publish(self):
        student = User.objects.create_user(
            username='draft-activity-student',
            email='draft-activity-student@example.com',
            password='secret123',
            role=User.RoleChoices.STUDENT,
            student_id='DRAFT-ACTIVITY-STUDENT',
            section=self.section_a,
        )
        self.client.force_authenticate(user=self.instructor)

        created = self.client.post('/api/activities/', {
            'title': 'Explicit publication activity',
            'assigned_sections': [self.section_a.pk],
        }, format='json')

        self.assertEqual(created.status_code, 201, created.json())
        self.assertEqual(created.json()['status'], Activity.StatusChoices.DRAFT)
        activity_id = created.json()['id']
        self.assertFalse(Notification.objects.filter(student=student, notification_type=Notification.TypeChoices.ACTIVITY).exists())

        self.client.force_authenticate(user=student)
        self.assertEqual(self.client.get(f'/api/activities/{activity_id}/').status_code, 404)
        self.assertNotIn(activity_id, {item['id'] for item in self.client.get('/api/activities/').json()['results']})
        submission = self.client.post('/api/submissions/', {
            'activity': activity_id,
            'file': SimpleUploadedFile('draft-work.pdf', b'%PDF-1.4\ndraft'),
        }, format='multipart')
        self.assertEqual(submission.status_code, 403)

        self.client.force_authenticate(user=self.instructor)
        published = self.client.patch(f'/api/activities/{activity_id}/', {'status': 'Published'}, format='json')
        self.assertEqual(published.status_code, 200, published.json())
        self.assertEqual(published.json()['status'], Activity.StatusChoices.PUBLISHED)
        self.assertTrue(Notification.objects.filter(student=student, notification_type=Notification.TypeChoices.ACTIVITY).exists())
        self.client.force_authenticate(user=student)
        self.assertEqual(self.client.get(f'/api/activities/{activity_id}/').status_code, 200)

    def test_assigned_student_count_includes_all_sections_without_duplicates(self):
        User.objects.create_user(
            username='activity-count-student-a',
            email='activity-count-student-a@example.com',
            password='secret123',
            role=User.RoleChoices.STUDENT,
            student_id='ACTIVITY-COUNT-A',
            section=self.section_a,
        )
        User.objects.create_user(
            username='activity-count-student-b',
            email='activity-count-student-b@example.com',
            password='secret123',
            role=User.RoleChoices.STUDENT,
            student_id='ACTIVITY-COUNT-B',
            section=self.section_b,
        )
        activity = Activity.objects.create(
            title='Multi-section count',
            section=self.section_a,
            created_by=self.instructor,
        )
        activity.assigned_sections.set([self.section_a, self.section_b])
        self.client.force_authenticate(user=self.instructor)

        response = self.client.get('/api/activities/')

        self.assertEqual(response.status_code, 200, response.json())
        result = next(item for item in response.json()['results'] if item['id'] == activity.pk)
        self.assertEqual(result['assigned_student_count'], 2)

    def test_instructor_can_create_academic_activity_without_cabinet_station(self):
        self.client.force_authenticate(user=self.instructor)

        response = self.client.post('/api/activities/', {
            'title': 'Station-free activity',
            'assigned_sections': [self.section_a.pk],
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()['cabinet_station'], '')

    def test_instructor_cannot_create_or_reassign_activity_to_unassigned_section(self):
        unrelated_section = Section.objects.create(
            section_name='Unrelated Section',
            subject_code='OTHER-SEC',
            instructor=self.other_instructor,
        )
        activity = Activity.objects.create(
            title='Owned activity',
            created_by=self.instructor,
            section=self.section_a,
        )
        self.client.force_authenticate(user=self.instructor)

        create_response = self.client.post('/api/activities/', {
            'title': 'Unauthorized activity',
            'assigned_sections': [unrelated_section.pk],
        }, format='json')
        update_response = self.client.patch(f'/api/activities/{activity.pk}/', {
            'assigned_sections': [unrelated_section.pk],
        }, format='json')

        self.assertEqual(create_response.status_code, 400, create_response.json())
        self.assertEqual(update_response.status_code, 400, update_response.json())
        self.assertFalse(Activity.objects.filter(title='Unauthorized activity').exists())
        activity.refresh_from_db()
        self.assertEqual(activity.section_id, self.section_a.pk)
        self.assertFalse(activity.assigned_sections.exists())

    def test_activity_without_deadline_is_serialized_as_null(self):
        activity = Activity.objects.create(title='No deadline activity', created_by=self.instructor, due_date=None)
        self.client.force_authenticate(user=self.instructor)

        response = self.client.get(f'/api/activities/{activity.pk}/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertIsNone(response.json()['due_date'])

    def test_activity_list_and_details_include_assigned_instructor_name(self):
        activity = Activity.objects.create(
            title='Different assigned instructor',
            created_by=self.instructor,
            assigned_instructor=self.other_instructor,
        )
        self.client.force_authenticate(user=self.instructor)

        list_response = self.client.get('/api/activities/')
        detail_response = self.client.get(f'/api/activities/{activity.pk}/')

        self.assertEqual(list_response.status_code, 200, list_response.json())
        self.assertEqual(detail_response.status_code, 200, detail_response.json())
        listed = next(item for item in list_response.json()['results'] if item['id'] == activity.pk)
        expected_name = self.other_instructor.get_full_name().strip() or self.other_instructor.username
        self.assertEqual(listed['assigned_instructor_name'], expected_name)
        self.assertEqual(detail_response.json()['assigned_instructor_name'], expected_name)

    def test_create_assigns_authenticated_instructor_and_list_is_isolated(self):
        self.client.force_authenticate(user=self.instructor)
        response = self.client.post('/api/activities/', {
            'title': 'Owned Activity',
            'section': self.section_a.section_id,
        }, format='json')

        self.assertEqual(response.status_code, 201)
        activity = Activity.objects.get(id=response.json()['id'])
        self.assertEqual(activity.created_by_id, self.instructor.id)

        self.client.force_authenticate(user=self.other_instructor)
        other_response = self.client.get('/api/activities/')
        other_results = other_response.json().get('results', other_response.json())
        self.assertNotIn(activity.id, [item['id'] for item in other_results])

        self.client.force_authenticate(user=self.instructor)
        own_response = self.client.get('/api/activities/')
        own_results = own_response.json().get('results', own_response.json())
        self.assertIn(activity.id, [item['id'] for item in own_results])

    def test_update_preserves_creator_and_rejects_client_ownership_change(self):
        activity = Activity.objects.create(title='Owned Activity', created_by=self.instructor)
        self.client.force_authenticate(user=self.instructor)

        response = self.client.patch(f'/api/activities/{activity.id}/', {
            'title': 'Updated Activity',
            'created_by': self.other_instructor.id,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        activity.refresh_from_db()
        self.assertEqual(activity.title, 'Updated Activity')
        self.assertEqual(activity.created_by_id, self.instructor.id)

    def test_instructor_can_upload_files_with_activity(self):
        self.client.force_authenticate(user=self.instructor)
        file_upload = SimpleUploadedFile('brief.pdf', b'%PDF-1.4\nfile-content', content_type='application/pdf')

        response = self.client.post('/api/activities/', {
            'title': 'Activity with File',
            'description': 'An activity with uploaded files.',
            'instructions': '<p>Read the brief.</p>',
            'activity_type': 'Project',
            'assigned_sections': [self.section_a.section_id],
            'assigned_instructor': self.instructor.id,
            'due_date': '2026-08-10T09:00:00Z',
            'max_score': 100,
            'cabinet_station': 'Cabinet 2',
            'status': 'Published',
            'attachments': [file_upload],
        }, format='multipart')

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data['attachments'])
        self.assertEqual(data['attachments'][0]['filename'], 'brief.pdf')
        self.assertEqual(data['attachments'][0]['content_type'], 'application/pdf')
        self.assertEqual(data['attachments'][0]['preview_kind'], 'activity')
        activity = Activity.objects.get(id=data['id'])
        self.assertTrue(activity.attachments.exists())

    def test_invalid_activity_attachment_rejects_activity_without_storing_any_file(self):
        self.client.force_authenticate(user=self.instructor)
        before_activities = Activity.objects.count()
        before_attachments = ActivityAttachment.objects.count()

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            valid_image = SimpleUploadedFile(
                'valid.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png',
            )
            mislabeled_pdf = SimpleUploadedFile('broken.pdf', b'not-a-pdf', content_type='application/pdf')
            response = self.client.post('/api/activities/', {
                'title': 'Must not be partially created',
                'assigned_sections': [self.section_a.pk],
                'attachments': [valid_image, mislabeled_pdf],
            }, format='multipart')

            self.assertEqual(response.status_code, 400, response.json())
            self.assertEqual(Activity.objects.count(), before_activities)
            self.assertEqual(ActivityAttachment.objects.count(), before_attachments)
            self.assertFalse(os.listdir(media_root))

    def test_instructor_can_edit_activity_and_keep_existing_attachments(self):
        self.client.force_authenticate(user=self.instructor)
        activity = Activity.objects.create(
            title='Editable Activity',
            description='Original description',
            instructions='Original instructions',
            created_by=self.instructor,
            section=self.section_a,
        )
        existing_attachment = ActivityAttachment.objects.create(activity=activity, file=SimpleUploadedFile('old.pdf', b'old', content_type='application/pdf'))

        new_file = SimpleUploadedFile('new.pdf', b'%PDF-1.4\nnew', content_type='application/pdf')
        response = self.client.patch(f'/api/activities/{activity.id}/', {
            'title': 'Updated Activity',
            'attachments': [new_file],
        }, format='multipart')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['title'], 'Updated Activity')
        self.assertEqual(len(data['attachments']), 2)
        remaining_ids = {item['id'] for item in data['attachments']}
        self.assertIn(existing_attachment.id, remaining_ids)

    def test_delete_attachment_endpoint_removes_database_and_file(self):
        self.client.force_authenticate(user=self.instructor)
        activity = Activity.objects.create(
            title='Deleteable Activity',
            description='desc',
            instructions='instr',
            created_by=self.instructor,
            section=self.section_a,
        )
        attachment = ActivityAttachment.objects.create(activity=activity, file=SimpleUploadedFile('delete-me.pdf', b'data', content_type='application/pdf'))

        response = self.client.delete(f'/api/activities/{activity.id}/attachments/{attachment.id}/')

        self.assertEqual(response.status_code, 204)
        self.assertFalse(ActivityAttachment.objects.filter(id=attachment.id).exists())


class SubmissionGradingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='instructor-grade',
            email='instructor-grade@example.com',
            password='secret123',
            role='instructor',
            first_name='Instructor',
            last_name='Grade',
            instructor_id='I-GRADE',
            nfc_uid='NFC-GRADE-001',
        )
        self.section = Section.objects.create(section_name='Section Grade', subject_code='SEC-G', instructor=self.instructor)
        self.activity = Activity.objects.create(
            title='Graded Activity',
            description='An activity for grading tests',
            instructions='Do the work',
            created_by=self.instructor,
            section=self.section,
            max_score=100,
        )
        self.student = User.objects.create_user(
            username='student-grade',
            email='student-grade@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='Grade',
            student_id='S-GRADE',
            section=self.section,
            nfc_uid='NFC-GRADE-002',
        )
        self.submission = Submission.objects.create(
            activity=self.activity,
            student=self.student,
            remarks='Initial submission',
            score=None,
            feedback='',
        )

    def test_instructor_can_grade_existing_submission(self):
        self.client.force_authenticate(user=self.instructor)

        response = self.client.post(f'/api/submissions/{self.submission.id}/grade/', {
            'score': 88,
            'feedback': 'Great work',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['score'], 88)
        self.assertEqual(data['feedback'], 'Great work')

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.score, 88)
        self.assertEqual(self.submission.feedback, 'Great work')
        self.assertEqual(self.submission.graded_by, self.instructor)
        self.assertIsNotNone(self.submission.graded_at)
        self.assertEqual(self.submission.status, 'Graded')

    def test_admin_cannot_grade_edit_or_delete_submissions(self):
        admin_user = User.objects.create_user(
            username='submission-admin',
            email='submission-admin@example.com',
            password='secret123',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin_user)

        update_response = self.client.patch(f'/api/submissions/{self.submission.pk}/', {'remarks': 'Admin edit'}, format='json')
        grade_response = self.client.post(f'/api/submissions/{self.submission.pk}/grade/', {'score': 95, 'feedback': 'Admin grade'}, format='json')
        delete_response = self.client.delete(f'/api/submissions/{self.submission.pk}/')

        self.assertEqual(update_response.status_code, 403)
        self.assertEqual(grade_response.status_code, 403)
        self.assertEqual(delete_response.status_code, 403)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.remarks, 'Initial submission')
        self.assertIsNone(self.submission.score)
        self.assertTrue(Submission.objects.filter(pk=self.submission.pk).exists())

    def test_submission_date_filter_uses_asia_manila_calendar_day(self):
        start_boundary = Submission.objects.create(activity=self.activity, student=self.student, attempt=2)
        end_boundary = Submission.objects.create(activity=self.activity, student=self.student, attempt=3)
        next_day = Submission.objects.create(activity=self.activity, student=self.student, attempt=4)
        Submission.objects.filter(pk=self.submission.pk).update(submitted_at=datetime(2026, 8, 10, 15, 59, tzinfo=ZoneInfo('UTC')))
        Submission.objects.filter(pk=start_boundary.pk).update(submitted_at=datetime(2026, 8, 10, 16, 0, tzinfo=ZoneInfo('UTC')))
        Submission.objects.filter(pk=end_boundary.pk).update(submitted_at=datetime(2026, 8, 11, 15, 59, tzinfo=ZoneInfo('UTC')))
        Submission.objects.filter(pk=next_day.pk).update(submitted_at=datetime(2026, 8, 11, 16, 0, tzinfo=ZoneInfo('UTC')))
        admin_user = User.objects.create_user(
            username='submission-date-admin',
            email='submission-date-admin@example.com',
            password='secret123',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin_user)

        response = self.client.get('/api/submissions/?submission_date=2026-08-11')

        self.assertEqual(response.status_code, 200, response.json())
        result_ids = [item['id'] for item in response.json()['results']]
        self.assertEqual(result_ids, [end_boundary.pk, start_boundary.pk])

    def test_student_submission_status_filters_match_display_statuses(self):
        self.activity.due_date = timezone.now() + timedelta(days=1)
        self.activity.status = Activity.StatusChoices.PUBLISHED
        self.activity.save(update_fields=['due_date', 'status'])
        returned = Submission.objects.create(
            activity=self.activity,
            student=self.student,
            attempt=2,
            feedback='Please revise this section.',
        )
        graded = Submission.objects.create(
            activity=self.activity,
            student=self.student,
            attempt=3,
            score=90,
        )
        late_activity = Activity.objects.create(
            title='Past due activity',
            created_by=self.instructor,
            section=self.section,
            due_date=timezone.now() - timedelta(days=1),
            status=Activity.StatusChoices.PUBLISHED,
        )
        late = Submission.objects.create(
            activity=late_activity,
            student=self.student,
            attempt=1,
        )
        self.client.force_authenticate(user=self.student)

        expected = {
            'under_review': {self.submission.pk},
            'submitted': {self.submission.pk},
            'returned_for_revision': {returned.pk},
            'graded': {graded.pk},
            'late': {late.pk},
        }
        for status_filter, expected_ids in expected.items():
            with self.subTest(status=status_filter):
                response = self.client.get('/api/submissions/', {'status': status_filter})
                self.assertEqual(response.status_code, 200, response.json())
                self.assertEqual({item['id'] for item in response.json()['results']}, expected_ids)

        summary = self.client.get('/api/submissions/stats/').json()
        self.assertEqual(summary['totalSubmissions'], 4)
        self.assertEqual(summary['underReview'], 1)
        self.assertEqual(summary['returnedForRevision'], 1)
        self.assertEqual(summary['graded'], 1)
        self.assertEqual(summary['lateSubmissions'], 1)

    def test_assigned_section_instructor_can_grade_and_view_stats(self):
        assigned_instructor = User.objects.create_user(
            username='assigned-grader',
            email='assigned-grader@example.com',
            password='secret123',
            role='instructor',
            instructor_id='I-ASSIGNED-GRADE',
            nfc_uid='NFC-ASSIGNED-GRADE-001',
        )
        assigned_instructor.assigned_sections.add(self.section)
        self.client.force_authenticate(user=assigned_instructor)

        stats = self.client.get('/api/submissions/stats/')
        self.assertEqual(stats.status_code, 200, stats.json())
        self.assertEqual(stats.json()['totalSubmissions'], 1)
        self.assertEqual(stats.json()['pendingReview'], 1)

        response = self.client.post(f'/api/submissions/{self.submission.id}/grade/', {
            'score': 88,
            'feedback': 'Reviewed for the assigned section',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['graded_by'], assigned_instructor.pk)

    def test_unassigned_instructor_cannot_grade_another_sections_submission(self):
        other = User.objects.create_user(
            username='unassigned-grader',
            email='unassigned-grader@example.com',
            password='secret123',
            role='instructor',
            instructor_id='I-UNASSIGNED-GRADE',
            nfc_uid='NFC-UNASSIGNED-GRADE-001',
        )
        self.client.force_authenticate(user=other)

        response = self.client.post(f'/api/submissions/{self.submission.id}/grade/', {
            'score': 88,
            'feedback': 'Should not be accepted',
        }, format='json')

        self.assertEqual(response.status_code, 404)
        self.submission.refresh_from_db()
        self.assertIsNone(self.submission.score)

    def test_grade_rejects_score_above_maximum(self):
        self.client.force_authenticate(user=self.instructor)

        response = self.client.post(f'/api/submissions/{self.submission.id}/grade/', {
            'score': 101,
            'feedback': 'Too high',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('cannot exceed', response.json()['detail'])

        self.submission.refresh_from_db()
        self.assertIsNone(self.submission.score)
        self.assertEqual(self.submission.feedback, '')

    def test_grade_rejects_negative_score(self):
        self.client.force_authenticate(user=self.instructor)

        response = self.client.post(f'/api/submissions/{self.submission.id}/grade/', {
            'score': -1,
            'feedback': 'Negative score',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('cannot be negative', response.json()['detail'])

        self.submission.refresh_from_db()
        self.assertIsNone(self.submission.score)
        self.assertEqual(self.submission.feedback, '')


class StudentNotificationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='student3',
            email='student3@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='Three',
            student_id='S003',
        )
        self.other_student = User.objects.create_user(
            username='student4',
            email='student4@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='Four',
            student_id='S004',
        )
        Notification.objects.create(
            student=self.student,
            title='New activity assigned',
            message='A new activity is ready for you.',
            notification_type='deadline',
            link='/student/activities',
        )
        Notification.objects.create(
            student=self.other_student,
            title='Hidden notification',
            message='This should not be visible.',
            notification_type='submission',
            link='/student/submissions',
        )

    def test_student_only_sees_their_own_notifications(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/notifications/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        results = data.get('results', [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['title'], 'New activity assigned')

    def test_student_unread_count_is_private(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/notifications/unread_count/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['unread_count'], 1)

    def test_authenticated_instructor_comment_notifies_assigned_student(self):
        instructor = User.objects.create_user(
            username='comment-instructor',
            email='comment-instructor@example.com',
            password='secret123',
            role='instructor',
            instructor_id='I-COMMENT',
            nfc_uid='NFC-COMMENT',
        )
        section = Section.objects.create(section_name='Comment Section', instructor=instructor)
        self.student.section = section
        self.student.save(update_fields=['section'])
        activity = Activity.objects.create(title='Discuss this', created_by=instructor, section=section)

        self.client.force_authenticate(user=instructor)
        response = self.client.post('/api/activity-discussions/', {
            'activity': activity.id,
            'message': 'Please review this activity.',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.client.force_authenticate(user=self.student)
        notifications = self.client.get('/api/notifications/').json()['results']
        feedback_notifications = [
            item for item in notifications
            if item['notification_type'] == 'feedback'
        ]
        self.assertEqual(len(feedback_notifications), 1)
        self.assertEqual(feedback_notifications[0]['student'], self.student.id)
        self.assertFalse(
            Notification.objects.filter(
                student=self.other_student,
                notification_type=Notification.TypeChoices.FEEDBACK,
            ).exists()
        )


class StudentProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='student5',
            email='student5@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='Five',
            student_id='S005',
            nfc_uid='STUDENT-PROFILE-UID',
        )

    def test_student_can_view_own_profile(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/users/profile/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], self.student.id)
        self.assertEqual(response.json()['student_id'], 'S005')
        self.assertNotIn('nfc_uid', response.json())

    def test_student_profile_resolves_instructors_from_section_relationships(self):
        primary = User.objects.create_user(
            username='section-primary-instructor',
            email='section-primary-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='SECTION-PRIMARY',
            first_name='Primary',
            last_name='Teacher',
            contact_number='555-0101',
        )
        assigned = User.objects.create_user(
            username='section-assigned-instructor',
            email='section-assigned-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='SECTION-ASSIGNED',
            first_name='Assigned',
            last_name='Teacher',
            contact_number='555-0102',
        )
        section = Section.objects.create(
            section_name='Student Profile Section',
            program='Information Technology',
            year_level='3',
            academic_year='2026-2027',
            instructor=primary,
        )
        section.assigned_instructors.add(primary, assigned)
        self.student.section = section
        self.student.save(update_fields=['section'])
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/users/profile/')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertEqual(payload['section_program'], 'Information Technology')
        self.assertEqual(payload['section_name'], 'Student Profile Section')
        self.assertEqual(
            [(instructor['id'], instructor['full_name']) for instructor in payload['section_instructors']],
            [(primary.pk, 'Primary Teacher'), (assigned.pk, 'Assigned Teacher')],
        )
        self.assertEqual(payload['section_instructors'][0]['email'], primary.email)
        self.assertEqual(payload['section_instructors'][0]['contact_number'], '555-0101')
        self.assertEqual(payload['section_instructors'][0]['role'], User.RoleChoices.INSTRUCTOR)
        self.assertNotIn('nfc_uid', payload)

    def test_student_can_update_editable_profile_fields(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.patch('/api/users/update_profile/', {
            'email': 'updated@example.com',
            'contact_number': '09171234567',
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['email'], 'updated@example.com')
        self.assertEqual(response.json()['contact_number'], '09171234567')


class StudentActivityAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='student-activity-instructor',
            email='student-activity-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='STUDENT-ACTIVITY-INSTRUCTOR',
        )
        self.section = Section.objects.create(section_name='Student Activity Section', instructor=self.instructor)
        self.other_section = Section.objects.create(section_name='Other Student Activity Section')
        self.student = User.objects.create_user(
            username='activity-student',
            email='activity-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='ACTIVITY-STUDENT',
            section=self.section,
        )
        self.other_student = User.objects.create_user(
            username='activity-other-student',
            email='activity-other-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='ACTIVITY-OTHER-STUDENT',
            section=self.other_section,
        )
        self.section_activity = Activity.objects.create(
            title='Legacy section activity',
            section=self.section,
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        self.assigned_activity = Activity.objects.create(
            title='M2M assigned activity',
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )
        self.assigned_activity.assigned_sections.add(self.section)
        self.unrelated_activity = Activity.objects.create(
            title='Unrelated activity',
            section=self.other_section,
            created_by=self.instructor,
        )
        self.draft_activity = Activity.objects.create(
            title='Private draft activity',
            section=self.section,
            created_by=self.instructor,
        )
        self.draft_submission = Submission.objects.create(
            activity=self.draft_activity,
            student=self.student,
            file=SimpleUploadedFile('draft-work.pdf', b'%PDF-1.4\ndraft'),
        )
        self.client.force_authenticate(user=self.student)

    def test_student_activity_lists_and_stats_include_only_assigned_sections(self):
        response = self.client.get('/api/activities/')
        stats = self.client.get('/api/activities/stats/')
        dashboard = self.client.get('/api/dashboard/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(
            {item['id'] for item in response.json()['results']},
            {self.section_activity.pk, self.assigned_activity.pk},
        )
        self.assertEqual(self.client.get(f'/api/activities/{self.unrelated_activity.pk}/').status_code, 404)
        self.assertEqual(stats.status_code, 200, stats.json())
        self.assertEqual(stats.json()['total_activities'], 2)
        submission_list = self.client.get('/api/submissions/')
        self.assertEqual(submission_list.status_code, 200, submission_list.json())
        self.assertNotIn(self.draft_submission.pk, {item['id'] for item in submission_list.json()['results']})
        self.assertTrue(Submission.objects.filter(pk=self.draft_submission.pk).exists())
        self.assertEqual(dashboard.status_code, 200, dashboard.json())
        self.assertEqual(dashboard.json()['total_activities'], 2)
        self.assertEqual(
            {item['id'] for item in dashboard.json()['upcoming_activities']},
            {self.section_activity.pk, self.assigned_activity.pk},
        )
        create_activity = self.client.post('/api/activities/', {'title': 'Student-created activity'}, format='json')
        edit_activity = self.client.patch(f'/api/activities/{self.assigned_activity.pk}/', {'title': 'Student-edited activity'}, format='json')
        create_section = self.client.post('/api/sections/', {'section_name': 'Student-created section'}, format='json')
        self.assertEqual(create_activity.status_code, 403)
        self.assertEqual(edit_activity.status_code, 403)
        self.assertEqual(create_section.status_code, 403)

    def test_student_can_submit_and_edit_own_submission_without_creating_duplicates(self):
        upload = SimpleUploadedFile('work.pdf', b'%PDF-1.4\nwork', content_type='application/pdf')
        create_response = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'remarks': 'Initial note',
            'file': upload,
        }, format='multipart')

        self.assertEqual(create_response.status_code, 201, create_response.json())
        submission_id = create_response.json()['id']
        other_submission = Submission.objects.create(
            activity=self.assigned_activity,
            student=self.other_student,
            file=SimpleUploadedFile('other-work.pdf', b'other', content_type='application/pdf'),
        )
        list_response = self.client.get('/api/submissions/')
        self.assertEqual({item['id'] for item in list_response.json()['results']}, {submission_id})
        self.assertEqual(self.client.get(f'/api/submissions/{other_submission.pk}/').status_code, 404)

        update_response = self.client.patch(f'/api/submissions/{submission_id}/', {
            'activity': self.assigned_activity.pk,
            'remarks': 'Updated note',
        }, format='json')
        grade_attempt = self.client.patch(f'/api/submissions/{submission_id}/', {'score': 95, 'feedback': 'Student supplied'}, format='json')
        grade_action = self.client.post(f'/api/submissions/{submission_id}/grade/', {'score': 95}, format='json')
        grade_create = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'remarks': 'Grade injection attempt',
            'score': 95,
            'feedback': 'Student supplied',
            'file': SimpleUploadedFile('grade-attempt.pdf', b'%PDF-1.4\ngrade', content_type='application/pdf'),
        }, format='multipart')
        unrelated_submission = self.client.post('/api/submissions/', {
            'activity': self.unrelated_activity.pk,
            'remarks': 'Must not be accepted',
            'file': SimpleUploadedFile('unrelated.pdf', b'%PDF-1.4\nunrelated', content_type='application/pdf'),
        }, format='multipart')

        self.assertEqual(update_response.status_code, 200, update_response.json())
        self.assertEqual(grade_attempt.status_code, 400, grade_attempt.json())
        self.assertEqual(grade_action.status_code, 403)
        self.assertEqual(grade_create.status_code, 400, grade_create.json())
        self.assertEqual(unrelated_submission.status_code, 403)
        self.assertEqual(Submission.objects.filter(activity=self.assigned_activity, student=self.student).count(), 1)
        self.assertTrue(Submission.objects.filter(pk=other_submission.pk).exists())
        self.assertEqual(Submission.objects.get(pk=submission_id).remarks, 'Updated note')
        self.assertIsNone(Submission.objects.get(pk=submission_id).score)
        self.assertTrue(update_response.json()['files'][0]['name'].startswith('work'))
        self.assertIsNone(update_response.json()['files'][0]['url'])
        self.assertEqual(update_response.json()['files'][0]['preview_kind'], 'submission_file')

    def test_completed_tigris_temporary_upload_is_linked_without_copying_object(self):
        uploaded = TemporaryUpload.objects.create(
            user=self.student,
            activity=self.assigned_activity,
            original_filename='defense.mp4',
            file_size=512 * 1024 * 1024,
            content_type='video/mp4',
            file=SimpleUploadedFile('defense.mp4', b'\x00\x00\x00\x18ftypisom-placeholder'),
        )
        stored_key = uploaded.file.name
        self.assertTrue(stored_key.startswith(f'submissions/videos/{self.student.pk}/'))
        self.client.force_authenticate(user=self.student)

        response = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'temp_upload_ids': [uploaded.pk],
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        submission = Submission.objects.get(pk=response.json()['id'])
        attachment = submission.attachments.get()
        self.assertEqual(attachment.file.name, stored_key)
        self.assertEqual(attachment.original_filename, 'defense.mp4')
        self.assertEqual(attachment.file_size, 512 * 1024 * 1024)
        self.assertTrue(attachment.file.storage.exists(stored_key))
        self.assertFalse(TemporaryUpload.objects.filter(pk=uploaded.pk).exists())

    def test_student_uploads_are_limited_to_assigned_activities_and_matching_submissions(self):
        invalid_activity_upload = self.client.post('/api/student/submissions/upload', {
            'activity': self.unrelated_activity.pk,
            'files': [SimpleUploadedFile('not-allowed.pdf', b'no', content_type='application/pdf')],
        }, format='multipart')
        valid_upload = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': [SimpleUploadedFile('assigned.pdf', b'%PDF-1.4\nyes', content_type='application/pdf')],
        }, format='multipart')

        self.assertEqual(invalid_activity_upload.status_code, 404)
        self.assertEqual(valid_upload.status_code, 201, valid_upload.json())
        temporary_upload = TemporaryUpload.objects.get(pk=valid_upload.json()['uploads'][0]['id'])
        self.assertEqual(temporary_upload.activity_id, self.assigned_activity.pk)
        unrelated_upload = TemporaryUpload.objects.create(
            user=self.student,
            activity=self.unrelated_activity,
            file=SimpleUploadedFile('wrong-activity.pdf', b'wrong', content_type='application/pdf'),
        )
        mismatched_attachment = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'temp_upload_ids': [unrelated_upload.pk],
        }, format='json')
        self.assertEqual(mismatched_attachment.status_code, 400, mismatched_attachment.json())

    def test_student_can_replace_legacy_submission_file(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        submission = Submission.objects.create(
            activity=self.assigned_activity,
            student=self.student,
            file=SimpleUploadedFile('old.png', b'\x89PNG\r\n\x1a\nold-image', content_type='image/png'),
        )
        old_file_name = submission.file.name
        staged = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'remove_primary_file': True,
            'files': [SimpleUploadedFile('replacement.png', b'\x89PNG\r\n\x1a\nnew-image', content_type='image/png')],
        }, format='multipart')
        self.assertEqual(staged.status_code, 201, staged.json())

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(f'/api/submissions/{submission.pk}/', {
                'remove_primary_file': True,
                'temp_upload_ids': [staged.json()['uploads'][0]['id']],
            }, format='multipart')

        self.assertEqual(response.status_code, 200, response.json())
        submission.refresh_from_db()
        self.assertEqual(submission.attachments.count(), 1, response.json())
        self.assertEqual(submission.file.name, submission.attachments.first().file.name)
        self.assertFalse(submission.file.storage.exists(old_file_name))

    def test_student_can_upload_and_submit_five_supported_files_as_one_submission(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        files = [
            SimpleUploadedFile(f'image-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png')
            for index in range(5)
        ]

        uploaded = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': files,
        }, format='multipart')

        self.assertEqual(uploaded.status_code, 201, uploaded.json())
        upload_ids = [item['id'] for item in uploaded.json()['uploads']]
        submitted = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'remarks': 'Five files in one submission.',
            'temp_upload_ids': upload_ids,
        }, format='multipart')

        self.assertEqual(submitted.status_code, 201, submitted.json())
        submission = Submission.objects.get(pk=submitted.json()['id'])
        self.assertEqual(submission.attachments.count(), 5)
        self.assertEqual(len(submitted.json()['files']), 5)
        self.assertFalse(TemporaryUpload.objects.filter(pk__in=upload_ids).exists())
        self.assertTrue(all(attachment.file.storage.exists(attachment.file.name) for attachment in submission.attachments.all()))

    def test_student_six_file_draft_batch_is_rejected_without_partial_storage(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        files = [
            SimpleUploadedFile(f'image-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png')
            for index in range(6)
        ]

        response = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': files,
        }, format='multipart')

        self.assertEqual(response.status_code, 400, response.json())
        self.assertIn('at most 5 files', ' '.join(response.json()['files']))
        self.assertFalse(TemporaryUpload.objects.filter(user=self.student).exists())
        self.assertEqual(os.listdir(media_directory.name), [])

    def test_student_cannot_exceed_five_files_across_separate_draft_uploads(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        first_batch = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': [
                SimpleUploadedFile(f'first-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png')
                for index in range(4)
            ],
        }, format='multipart')
        self.assertEqual(first_batch.status_code, 201, first_batch.json())

        second_batch = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': [
                SimpleUploadedFile(f'second-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png')
                for index in range(2)
            ],
        }, format='multipart')

        self.assertEqual(second_batch.status_code, 400, second_batch.json())
        self.assertIn('at most 5 files', ' '.join(second_batch.json()['files']))
        self.assertEqual(TemporaryUpload.objects.filter(user=self.student, activity=self.assigned_activity).count(), 4)

    def test_final_submission_rejects_six_temp_files_and_preserves_the_drafts(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        uploads = [
            TemporaryUpload.objects.create(
                user=self.student,
                activity=self.assigned_activity,
                file=SimpleUploadedFile(f'image-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png'),
            )
            for index in range(6)
        ]

        response = self.client.post('/api/submissions/', {
            'activity': self.assigned_activity.pk,
            'temp_upload_ids': [upload.pk for upload in uploads],
        }, format='multipart')

        self.assertEqual(response.status_code, 400, response.json())
        self.assertIn('at most 5 files', ' '.join(response.json()['files']))
        self.assertEqual(Submission.objects.filter(activity=self.assigned_activity, student=self.student).count(), 0)
        self.assertEqual(TemporaryUpload.objects.filter(pk__in=[upload.pk for upload in uploads]).count(), 6)

    def test_resubmission_counts_retained_attachments_and_preserves_them_on_rejection(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        submission = Submission.objects.create(activity=self.assigned_activity, student=self.student)
        existing_attachments = [
            SubmissionAttachment.objects.create(
                submission=submission,
                file=SimpleUploadedFile(
                    f'existing-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png',
                ),
            )
            for index in range(5)
        ]
        submission.file = existing_attachments[0].file
        submission.save(update_fields=['file'])
        staged = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'files': [SimpleUploadedFile('new.png', b'\x89PNG\r\n\x1a\nnew-image', content_type='image/png')],
        }, format='multipart')
        self.assertEqual(staged.status_code, 400, staged.json())
        self.assertIn('at most 5 files', ' '.join(staged.json()['files']))
        self.assertEqual(submission.attachments.count(), 5)
        self.assertTrue(all(attachment.file.storage.exists(attachment.file.name) for attachment in existing_attachments))
        self.assertFalse(TemporaryUpload.objects.filter(user=self.student, activity=self.assigned_activity).exists())

    def test_resubmission_can_replace_an_attachment_without_exceeding_the_file_limit(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        submission = Submission.objects.create(activity=self.assigned_activity, student=self.student)
        existing_attachments = [
            SubmissionAttachment.objects.create(
                submission=submission,
                file=SimpleUploadedFile(
                    f'existing-{index}.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png',
                ),
            )
            for index in range(5)
        ]
        submission.file = existing_attachments[0].file
        submission.save(update_fields=['file'])

        response = self.client.post('/api/student/submissions/upload', {
            'activity': self.assigned_activity.pk,
            'removed_attachment_ids': [existing_attachments[0].pk],
            'files': [SimpleUploadedFile('replacement.png', b'\x89PNG\r\n\x1a\nreplacement', content_type='image/png')],
        }, format='multipart')

        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(TemporaryUpload.objects.filter(user=self.student, activity=self.assigned_activity).count(), 1)

    def test_invalid_student_upload_batch_is_rejected_without_partial_temp_files(self):
        before_uploads = TemporaryUpload.objects.filter(user=self.student).count()

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            valid_image = SimpleUploadedFile(
                'valid.png', b'\x89PNG\r\n\x1a\nimage-data', content_type='image/png',
            )
            mislabeled_pdf = SimpleUploadedFile('broken.pdf', b'not-a-pdf', content_type='application/pdf')
            response = self.client.post('/api/student/submissions/upload', {
                'activity': self.assigned_activity.pk,
                'files': [valid_image, mislabeled_pdf],
            }, format='multipart')

            self.assertEqual(response.status_code, 400, response.json())
            self.assertEqual(TemporaryUpload.objects.filter(user=self.student).count(), before_uploads)
            self.assertFalse(os.listdir(media_root))

    def test_single_temporary_upload_rejects_mislabeled_file_before_storage(self):
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_directory.name))
        response = self.client.post('/api/temp-uploads/', {
            'file': SimpleUploadedFile('broken.pdf', b'not a PDF', content_type='application/pdf'),
            'activity': self.assigned_activity.pk,
        }, format='multipart')

        self.assertEqual(response.status_code, 400, response.json())
        self.assertIn('do not match', ' '.join(response.json()['files']))
        self.assertFalse(TemporaryUpload.objects.filter(user=self.student).exists())
        self.assertEqual(os.listdir(media_directory.name), [])


class InstructorProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='instructor5',
            email='instructor5@example.com',
            password='secret123',
            role='instructor',
            first_name='Instructor',
            last_name='Five',
            instructor_id='I005',
            nfc_uid='NFC-I005',
        )

    def test_instructor_can_update_editable_profile_fields(self):
        self.client.force_authenticate(user=self.instructor)

        response = self.client.patch('/api/users/update_profile/', {
            'first_name': 'Updated',
            'last_name': 'Instructor',
            'instructor_id': 'I005-UPDATED',
            'username': 'updated-instructor5',
            'email': 'updated-instructor5@example.com',
            'contact_number': '09171234567',
            'role': 'admin',
        })

        self.assertEqual(response.status_code, 200)
        self.instructor.refresh_from_db()
        self.assertEqual(self.instructor.first_name, 'Updated')
        self.assertEqual(self.instructor.last_name, 'Instructor')
        self.assertEqual(self.instructor.instructor_id, 'I005-UPDATED')
        self.assertEqual(self.instructor.username, 'updated-instructor5')
        self.assertEqual(self.instructor.email, 'updated-instructor5@example.com')
        self.assertEqual(self.instructor.contact_number, '09171234567')
        self.assertEqual(self.instructor.role, 'instructor')

    def test_instructor_profile_includes_assigned_section_academic_details(self):
        section = Section.objects.create(
            section_name='Instructor Profile Section',
            subject_code='IP-301',
            program='Information Technology',
            year_level='3',
            academic_year='2026-2027',
            instructor=self.instructor,
        )
        self.instructor.assigned_sections.add(section)
        self.client.force_authenticate(user=self.instructor)

        response = self.client.get('/api/users/profile/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['assigned_sections'], [{
            'section_id': section.pk,
            'section_name': 'Instructor Profile Section',
            'subject_code': 'IP-301',
            'program': 'Information Technology',
            'year_level': '3',
            'academic_year': '2026-2027',
        }])


class ProfileAdminFormTests(TestCase):
    def test_instructor_creation_form_does_not_require_student_id(self):
        from .admin import InstructorCreationForm

        form = InstructorCreationForm(data={
            'first_name': 'Test',
            'last_name': 'Instructor',
            'instructor_id': 'I100',
            'email': 'test-instructor@example.com',
            'nfc_uid': 'NFC-TEST-001',
            'password1': 'secret1234',
            'password2': 'secret1234',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.role, 'instructor')
        self.assertEqual(user.instructor_id, 'I100')
        self.assertIsNone(user.student_id)

    def test_student_creation_form_does_not_require_instructor_id(self):
        from .admin import StudentCreationForm

        form = StudentCreationForm(data={
            'first_name': 'Test',
            'last_name': 'Student',
            'student_id': 'S100',
            'email': 'test-student@example.com',
            'nfc_uid': 'NFC-STUD-001',
            'password1': 'secret1234',
            'password2': 'secret1234',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.role, 'student')
        self.assertEqual(user.student_id, 'S100')
        self.assertIsNone(user.instructor_id)

    def test_pre_enrollment_student_can_be_created_without_nfc_uid_or_password(self):
        from .admin import StudentCreationForm

        form = StudentCreationForm(data={
            'first_name': 'Roster',
            'last_name': 'Student',
            'student_id': 'ROSTER-100',
            'email': 'roster.student@example.com',
            'username': '',
            'nfc_uid': '',
            'password1': '',
            'password2': '',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.username, 'ROSTER-100')
        self.assertEqual(user.student_id, 'ROSTER-100')
        self.assertIsNone(user.nfc_uid)
        self.assertFalse(user.has_usable_password())

    def test_student_nfc_uid_remains_unique_when_present(self):
        User.objects.create_user(
            username='uid-owner',
            email='uid-owner@example.com',
            password=None,
            student_id='UID-OWNER-001',
            nfc_uid='NFC-UNIQUE-STUDENT-001',
        )
        duplicate = User(
            username='uid-duplicate',
            email='uid-duplicate@example.com',
            student_id='UID-DUPLICATE-001',
            nfc_uid='NFC-UNIQUE-STUDENT-001',
            role=User.RoleChoices.STUDENT,
        )
        duplicate.set_unusable_password()

        with self.assertRaises(ValidationError):
            duplicate.full_clean()

    def test_student_id_remains_required_without_nfc_uid(self):
        student = User(
            username='missing-student-id',
            email='missing-student-id@example.com',
            student_id='',
            nfc_uid=None,
            role=User.RoleChoices.STUDENT,
        )
        student.set_unusable_password()

        with self.assertRaises(ValidationError) as raised:
            student.full_clean()
        self.assertIn('student_id', raised.exception.message_dict)

    def test_admin_creation_form_does_not_create_mixed_role_data(self):
        from .admin import AdminCreationForm

        form = AdminCreationForm(data={
            'first_name': 'Test',
            'last_name': 'Admin',
            'email': 'test-admin@example.com',
            'nfc_uid': 'NFC-ADMIN-001',
            'password1': 'secret1234',
            'password2': 'secret1234',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.role, 'admin')
        self.assertIsNone(user.student_id)
        self.assertIsNone(user.instructor_id)
        self.assertFalse(user.assigned_sections.exists())
        from .models import AdminProfile
        self.assertIsInstance(user, AdminProfile)
        self.assertEqual(user._meta.model_name, 'adminprofile')

    def test_create_superuser_sets_admin_role_and_superuser_flags(self):
        from .models import User, AdminProfile, StudentProfile, InstructorProfile

        admin = User.objects.create_superuser(
            username='superadmin',
            email='superadmin@example.com',
            password='secret1234',
        )

        self.assertEqual(admin.role, User.RoleChoices.ADMIN)
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)
        self.assertFalse(StudentProfile.objects.filter(pk=admin.pk).exists())
        self.assertFalse(InstructorProfile.objects.filter(pk=admin.pk).exists())
        self.assertTrue(AdminProfile.objects.filter(pk=admin.pk).exists())
        self.assertEqual(admin._meta.model_name, 'user')
        self.assertEqual(admin._meta.app_label, 'api')

    def test_student_creation_form_saves_studentprofile_instance(self):
        from .admin import StudentCreationForm
        from .models import StudentProfile

        form = StudentCreationForm(data={
            'first_name': 'Test',
            'last_name': 'Student',
            'student_id': 'S200',
            'email': 'test-student2@example.com',
            'nfc_uid': 'NFC-STUD-002',
            'password1': 'secret1234',
            'password2': 'secret1234',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.role, 'student')
        self.assertIsInstance(user, StudentProfile)
        self.assertEqual(user._meta.model_name, 'studentprofile')

    def test_instructor_creation_form_saves_instructorprofile_instance(self):
        from .admin import InstructorCreationForm
        from .models import InstructorProfile

        form = InstructorCreationForm(data={
            'first_name': 'Test',
            'last_name': 'Instructor',
            'instructor_id': 'I200',
            'email': 'test-instructor2@example.com',
            'nfc_uid': 'NFC-INST-002',
            'password1': 'secret1234',
            'password2': 'secret1234',
            'is_active': True,
        })

        self.assertTrue(form.is_valid(), msg=form.errors)
        user = form.save()
        self.assertEqual(user.role, 'instructor')
        self.assertIsInstance(user, InstructorProfile)
        self.assertEqual(user._meta.model_name, 'instructorprofile')

    def test_instructor_admin_uses_autocomplete_for_assigned_sections(self):
        from .admin import InstructorProfileAdmin, SectionAdmin

        self.assertIn('assigned_sections', InstructorProfileAdmin.autocomplete_fields)
        self.assertIn('section_name', SectionAdmin.search_fields)
        self.assertIn('subject_code', SectionAdmin.search_fields)

    def test_section_admin_instructor_field_filters_instructors(self):
        from django.contrib import admin
        from .admin import SectionAdmin
        from .models import Section, User

        admin_instance = SectionAdmin(Section, admin.site)
        field = admin_instance.formfield_for_foreignkey(Section._meta.get_field('instructor'), None)
        self.assertEqual(field.queryset.filter(role=User.RoleChoices.INSTRUCTOR).count(), field.queryset.count())

    def test_activity_admin_instructor_fields_filter_to_instructors(self):
        from django.contrib import admin
        from .admin import ActivityAdmin
        from .models import Activity, User

        admin_instance = ActivityAdmin(Activity, admin.site)
        assigned_field = admin_instance.formfield_for_foreignkey(Activity._meta.get_field('assigned_instructor'), None)
        created_field = admin_instance.formfield_for_foreignkey(Activity._meta.get_field('created_by'), None)
        self.assertEqual(assigned_field.queryset.filter(role=User.RoleChoices.INSTRUCTOR).count(), assigned_field.queryset.count())
        self.assertEqual(created_field.queryset.filter(role=User.RoleChoices.INSTRUCTOR).count(), created_field.queryset.count())

    def test_submission_admin_student_field_filters_students(self):
        from django.contrib import admin
        from .admin import SubmissionAdmin, SubmissionAttachmentInline
        from .models import Submission, User

        admin_instance = SubmissionAdmin(Submission, admin.site)
        field = admin_instance.formfield_for_foreignkey(Submission._meta.get_field('student'), None)
        self.assertEqual(field.queryset.filter(role=User.RoleChoices.STUDENT).count(), field.queryset.count())
        self.assertIn(SubmissionAttachmentInline, SubmissionAdmin.inlines)


class TimezoneConfigurationTests(SimpleTestCase):
    def test_backend_uses_philippine_timezone(self):
        self.assertEqual(settings.TIME_ZONE, 'Asia/Manila')


class InstructorWorkbookImportTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin = User.objects.create_superuser(
            username='instructor-import-admin',
            email='instructor-import-admin@example.com',
            password='TestAdminPassword-123',
            nfc_uid='INSTRUCTOR-IMPORT-ADMIN-UID',
        )
        self.client.force_login(self.admin)
        self.section = Section.objects.create(subject_code='INST-SEC', section_name='Instructor Import Section')
        self.import_url = reverse('admin:api_instructorprofile_import_instructors')

    def test_instructor_admin_changelist_links_to_import_page(self):
        response = self.client.get(reverse('admin:api_instructorprofile_changelist'))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Import Instructors (.xlsx)')
        self.assertContains(response, self.import_url)


class StudentWorkbookImportTests(TestCase):
    HEADERS = ['Student ID', 'First Name', 'Last Name', 'Email', 'Role', 'Subject']

    def setUp(self):
        cache.clear()
        self.client = Client()
        self.admin = User.objects.create_superuser(
            username='student-import-admin',
            email='student-import-admin@example.com',
            password='TestAdminPassword-123',
            nfc_uid='STUDENT-IMPORT-ADMIN-UID',
        )
        self.client.force_login(self.admin)
        self.section = Section.objects.create(subject_code='XLSX-TEST', section_name='Excel Import Test Section')
        self.import_url = reverse('admin:api_studentprofile_import_students')

    @staticmethod
    def workbook_file(headers, rows, filename='students.xlsx'):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.append(headers)
        for row in rows:
            worksheet.append(row)
        contents = BytesIO()
        workbook.save(contents)
        return SimpleUploadedFile(
            filename,
            contents.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )

    def upload(self, headers, rows):
        return self.client.post(
            self.import_url,
            {'workbook': self.workbook_file(headers, rows)},
        )

    def test_required_columns_are_validated(self):
        response = self.upload(['first_name', 'email'], [['Avery', 'avery@example.com']])

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['errors'])
        self.assertFalse(User.objects.filter(email='avery@example.com').exists())

    def test_legacy_template_is_rejected_with_exact_new_column_order(self):
        legacy_headers = ['student_id', 'first_name', 'last_name', 'email', 'username', 'subject_code', 'role', 'active']
        response = self.upload(legacy_headers, [['OLD-100', 'Avery', 'Example', 'old@example.com', '', '', 'student', 'true']])

        self.assertTrue(any(error['column'] == 'header' and 'exact order' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='OLD-100').exists())

    def test_reordered_six_column_header_is_rejected_without_shifting_data(self):
        reordered_headers = ['First Name', 'Student ID', 'Last Name', 'Email', 'Role', 'Subject']
        response = self.upload(reordered_headers, [['Avery', 'SHIFT-100', 'Example', 'shift@example.com', 'student', 'XLSX-TEST']])

        self.assertTrue(any(error['column'] == 'header' and 'exact order' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='SHIFT-100').exists())
        self.assertFalse(User.objects.filter(first_name='Avery').exists())

    def test_malformed_xlsx_reports_a_file_error(self):
        workbook = SimpleUploadedFile('broken.xlsx', b'not an xlsx workbook')
        response = self.client.post(self.import_url, {'workbook': workbook})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(error['column'] == 'file' for error in response.context['errors']))

    def test_students_admin_changelist_links_to_import_page(self):
        response = self.client.get(reverse('admin:api_studentprofile_changelist'))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Import Students (.xlsx)')
        self.assertContains(response, self.import_url)

    def test_downloadable_template_uses_supported_columns_and_fake_data(self):
        from pathlib import Path
        from .student_import import read_student_workbook, validate_student_rows
        from .serializers import SectionSerializer

        template_path = Path(__file__).parent / 'static' / 'api' / 'student_import_template.xlsx'
        self.assertTrue(template_path.exists())
        template_workbook = load_workbook(template_path, read_only=True, data_only=True)
        self.assertEqual(
            next(template_workbook.active.iter_rows(values_only=True)),
            tuple(self.HEADERS),
        )
        self.assertEqual(
            next(template_workbook.active.iter_rows(min_row=2, max_row=2, values_only=True)),
            ('DEMO-STUDENT-001', 'Avery', 'Example', 'avery.example@example.invalid', 'student', None),
        )
        template_workbook.close()
        uploaded = SimpleUploadedFile(template_path.name, template_path.read_bytes())
        rows, errors = read_student_workbook(uploaded)
        prepared, row_errors = validate_student_rows(rows)

        self.assertFalse(errors)
        self.assertFalse(row_errors)
        self.assertEqual(len(prepared), 1)
        self.assertEqual(prepared[0]['student_id'], 'DEMO-STUDENT-001')
        self.assertEqual(prepared[0]['email'], 'avery.example@example.invalid')
        self.assertEqual(prepared[0]['role'], User.RoleChoices.STUDENT)
        self.assertIsNone(prepared[0]['section_id'])
        self.assertEqual(SectionSerializer(self.section).data['subject_code'], 'XLSX-TEST')
        self.assertEqual(Section._meta.get_field('subject_code').verbose_name, 'Subject Code')
        self.assertFalse(User.objects.filter(student_id='DEMO-STUDENT-001').exists())

    def test_duplicate_student_id_and_email_inside_workbook_are_rejected(self):
        headers = self.HEADERS
        rows = [
            ['DUP-100', 'Avery', 'Example', 'same@example.com', 'student', ''],
            ['DUP-100', 'Casey', 'Example', 'same@example.com', 'student', ''],
        ]
        response = self.upload(headers, rows)

        self.assertTrue(response.context['errors'])
        self.assertTrue(any(error['row'] == 3 and error['column'] == 'student_id' for error in response.context['errors']))
        self.assertTrue(any(error['row'] == 3 and error['column'] == 'email' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='DUP-100').exists())
        self.assertFalse(User.objects.filter(email='same@example.com').exists())

    def test_existing_student_id_is_rejected_without_overwriting(self):
        existing = User.objects.create_user(
            username='existing-student',
            email='existing.student@example.com',
            password=None,
            student_id='EXISTING-100',
            role=User.RoleChoices.STUDENT,
        )
        response = self.upload(
            self.HEADERS,
            [['EXISTING-100', 'Changed', 'Name', 'changed@example.com', 'student', '']],
        )

        self.assertTrue(response.context['errors'])
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, '')
        self.assertFalse(User.objects.filter(email='changed@example.com').exists())

    def test_existing_email_is_rejected(self):
        User.objects.create_user(
            username='existing-email-student',
            email='already.used@example.com',
            password=None,
            student_id='EMAIL-100',
            role=User.RoleChoices.STUDENT,
        )
        response = self.upload(
            self.HEADERS,
            [['EMAIL-101', 'Avery', 'Example', 'already.used@example.com', 'student', '']],
        )

        self.assertTrue(any(error['column'] == 'email' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='EMAIL-101').exists())

    def test_existing_username_is_rejected(self):
        generated_username = 'student_USERNAME-NEW-100'
        User.objects.create_user(
            username=generated_username,
            email='username.owner@example.com',
            password=None,
            student_id='USERNAME-OWNER-100',
            role=User.RoleChoices.STUDENT,
        )
        response = self.upload(
            self.HEADERS,
            [['USERNAME-NEW-100', 'Avery', 'Example', 'new.username@example.com', 'student', '']],
        )

        self.assertTrue(any(error['column'] == 'username' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='USERNAME-NEW-100').exists())

    def test_invalid_subject_code_reports_row_and_imports_nothing(self):
        response = self.upload(
            self.HEADERS,
            [
                ['SECTION-VALID-100', 'Casey', 'Example', 'casey.section@example.com', 'student', 'XLSX-TEST'],
                ['SECTION-INVALID-100', 'Avery', 'Example', 'avery.section@example.com', 'student', 'MISSING-SECTION'],
            ],
        )

        self.assertTrue(any(error['row'] == 3 and error['column'] == 'subject' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id__in=['SECTION-VALID-100', 'SECTION-INVALID-100']).exists())

    def test_ambiguous_subject_code_is_rejected(self):
        Section.objects.create(subject_code='DUPLICATE-CODE', section_name='Duplicate Section One')
        Section.objects.create(subject_code='duplicate-code', section_name='Duplicate Section Two')
        response = self.upload(
            self.HEADERS,
            [['SECTION-DUP-100', 'Avery', 'Example', 'section.duplicate@example.com', 'student', 'Duplicate-Code']],
        )

        self.assertTrue(any(error['column'] == 'subject' and 'More than one' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='SECTION-DUP-100').exists())

    def test_nfc_uid_and_password_columns_are_not_accepted(self):
        response = self.upload(
            self.HEADERS + ['NFC UID', 'Password'],
            [['SECURITY-100', 'Avery', 'Example', 'security@example.com', 'student', '', 'NFC-UID', 'do-not-import']],
        )

        self.assertTrue(any(error['column'] == 'header' and 'exact order' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='SECURITY-100').exists())

    def test_invalid_email_role_and_subject_values_are_rejected(self):
        response = self.upload(
            self.HEADERS,
            [['BAD-100', 'Avery', 'Example', 'not-an-email', 'admin', 'MISSING-SUBJECT']],
        )

        self.assertEqual({error['column'] for error in response.context['errors']}, {'email', 'role', 'subject'})
        self.assertFalse(User.objects.filter(student_id='BAD-100').exists())

    def test_role_is_required_and_imported_role_is_student_only(self):
        response = self.upload(
            self.HEADERS,
            [
                ['ROLE-BLANK-100', 'Avery', 'Example', 'blank.role@example.com', '', ''],
                ['ROLE-ADMIN-100', 'Casey', 'Example', 'admin.role@example.com', 'admin', ''],
            ],
        )

        self.assertTrue(any(error['row'] == 2 and error['column'] == 'role' and 'required' in error['message'] for error in response.context['errors']))
        self.assertTrue(any(error['row'] == 3 and error['column'] == 'role' and 'Only the student role' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id__in=['ROLE-BLANK-100', 'ROLE-ADMIN-100']).exists())

    def test_duplicate_generated_username_is_rejected(self):
        response = self.upload(
            self.HEADERS,
            [
                ['SAME USER', 'Avery', 'Example', 'avery.one@example.com', 'student', ''],
                ['SAME_USER', 'Casey', 'Example', 'casey.two@example.com', 'student', ''],
            ],
        )

        self.assertTrue(any(error['column'] == 'username' and error['row'] == 3 for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id__in=['SAME USER', 'SAME_USER']).exists())

    def test_successful_import_is_confirmed_atomically_and_uses_unusable_passwords(self):
        response = self.upload(
            self.HEADERS,
            [
                ['IMPORT-100', 'Avery', 'Example', 'avery.import@example.com', 'student', 'XLSX-TEST'],
                ['IMPORT-101', 'Casey', 'Example', 'casey.import@example.com', 'student', ''],
            ],
        )
        self.assertFalse(response.context['errors'])
        self.assertTrue(response.context['confirm_nonce'])
        self.assertEqual(User.objects.filter(student_id__in=['IMPORT-100', 'IMPORT-101']).count(), 0)

        confirmed = self.client.post(self.import_url, {
            'action': 'confirm',
            'confirm_nonce': response.context['confirm_nonce'],
        })

        self.assertEqual(confirmed.context['result'], {'created': 2, 'updated': 0})
        students = list(User.objects.filter(student_id__in=['IMPORT-100', 'IMPORT-101']).order_by('student_id'))
        self.assertEqual(len(students), 2)
        self.assertEqual(students[0].username, 'student_IMPORT-100')
        self.assertEqual(students[0].section, self.section)
        self.assertTrue(students[0].is_active)
        self.assertEqual(students[0].role, User.RoleChoices.STUDENT)
        self.assertIsNone(students[0].nfc_uid)
        self.assertFalse(students[0].has_usable_password())
        self.assertTrue(students[1].is_active)
        self.assertIsNone(students[1].section)

    @override_settings(TAPTRACK_NFC_DEVICE_MAP=[
        {'device_id': 'CABINET1-STATION1', 'api_key': 'unit-test-device-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True},
    ])
    def test_imported_student_can_complete_existing_nfc_enrollment_flow(self):
        upload = self.upload(
            self.HEADERS,
            [['ENROLL-100', 'Taylor', 'Example', 'taylor.enroll@example.com', 'student', 'XLSX-TEST']],
        )
        self.client.post(self.import_url, {
            'action': 'confirm',
            'confirm_nonce': upload.context['confirm_nonce'],
        })
        student = User.objects.get(student_id='ENROLL-100')
        test_uid = 'EXCEL-ENROLL-UID-100'
        device_key = 'unit-test-device-key'
        previous_key = os.environ.get('DEVICE_API_KEY')
        os.environ['DEVICE_API_KEY'] = device_key
        try:
            initial = self.client.post('/api/verify-nfc/', {'nfc_uid': test_uid}, HTTP_X_API_KEY=device_key)
            self.assertEqual(initial.status_code, 404, initial.json())
            token = parse_qs(urlparse(initial.json()['registration_url']).query)['token'][0]
            registration = register_nfc_with_email_code(self.client, {
                'token': token,
                'role': 'student',
                'username': 'taylor_enroll',
                'student_id': student.student_id,
                'password': 'Enrollment-Test-Password-123',
                'confirm_password': 'Enrollment-Test-Password-123',
            })
            self.assertEqual(registration.status_code, 201, registration.json())
            registration_log = AccessLog.objects.get(
                nfc_uid=test_uid,
                action=AccessLog.AccessActionChoices.REGISTRATION,
            )
            self.assertEqual(registration_log.user, student)
            self.assertEqual(registration_log.status, AccessLog.AccessStatusChoices.SUCCESS)
            self.assertEqual(registration_log.station, 'Station 1')
            self.assertEqual(registration_log.cabinet_name, 'Cabinet 1')
            self.assertEqual(registration_log.reason, 'NFC card registered successfully')
            verification = self.client.post('/api/verify-nfc/', {'nfc_uid': test_uid}, HTTP_X_API_KEY=device_key)
            self.assertEqual(verification.status_code, 200, verification.json())
            self.assertEqual(verification.json()['student_id'], 'ENROLL-100')
            self.assertEqual(verification.json()['role'], 'student')
        finally:
            if previous_key is None:
                os.environ.pop('DEVICE_API_KEY', None)
            else:
                os.environ['DEVICE_API_KEY'] = previous_key


    class CustomAdminUserImportAPITests(TestCase):
        def setUp(self):
            self.client = APIClient()
            self.admin = User.objects.create_superuser(
                username='custom-import-admin',
                email='custom-import-admin@example.com',
                password='TestAdminPassword-123',
                nfc_uid='CUSTOM-IMPORT-ADMIN-UID',
            )
            self.primary_instructor = User.objects.create_user(
                username='import-primary-instructor',
                email='import-primary-instructor@example.com',
                password='TestInstructorPassword-123',
                role=User.RoleChoices.INSTRUCTOR,
                instructor_id='IMPORT-PRIMARY-INSTRUCTOR',
                nfc_uid='IMPORT-PRIMARY-UID',
            )
            self.section = Section.objects.create(
                subject_code='IMPORT-SEC-1',
                section_name='Import Section One',
                program='BSCS',
                year_level='3',
                academic_year='2026-2027',
                instructor=self.primary_instructor,
            )

        @staticmethod
        def xlsx_file(headers, rows, name='custom-import.xlsx'):
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(headers)
            for row in rows:
                sheet.append(row)
            data = BytesIO()
            workbook.save(data)
            return SimpleUploadedFile(name, data.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

        def test_student_xlsx_preview_does_not_write_and_confirm_revalidates(self):
            self.client.force_authenticate(user=self.admin)
            headers = [
                'Student ID', 'First Name', 'Last Name', 'Email', 'Contact Number',
                'Section', 'Program', 'Year Level', 'Academic Year', 'Account Status',
            ]
            rows = [
                ['CUSTOM-STU-100', 'Avery', 'Example', 'avery.custom@example.com', '09170000001', 'IMPORT-SEC-1', 'BSCS', '3', '2026-2027', 'Inactive'],
                ['CUSTOM-STU-100', 'Casey', 'Example', 'casey.custom@example.com', '09170000002', 'IMPORT-SEC-1', 'BSCS', '3', '2026-2027', 'Active'],
            ]
            preview = self.client.post('/api/users/import/preview/', {
                'role': 'student',
                'file': self.xlsx_file(headers, rows),
            }, format='multipart')

            self.assertEqual(preview.status_code, 200, preview.json())
            payload = preview.json()
            self.assertEqual(payload['total_rows'], 2)
            self.assertEqual(payload['valid_rows'], 1)
            self.assertEqual(payload['duplicate_rows'], 1)
            self.assertEqual(payload['rows'][0]['validation_status'], 'Valid')
            self.assertEqual(payload['rows'][1]['validation_status'], 'Duplicate')
            self.assertFalse(User.objects.filter(student_id='CUSTOM-STU-100').exists())

            confirmed = self.client.post('/api/users/import/confirm/', {
                'role': 'student',
                'file': self.xlsx_file(headers, rows),
            }, format='multipart')

            self.assertEqual(confirmed.status_code, 201, confirmed.json())
            self.assertEqual(confirmed.json()['successfully_imported'], 1)
            self.assertEqual(confirmed.json()['skipped'], 1)
            student = User.objects.get(student_id='CUSTOM-STU-100')
            self.assertEqual(student.email, 'avery.custom@example.com')
            self.assertEqual(student.contact_number, '09170000001')
            self.assertEqual(student.section, self.section)
            self.assertFalse(student.is_active)
            self.assertIsNone(student.nfc_uid)
            self.assertFalse(student.has_usable_password())
            self.assertFalse(student.is_staff)
            self.assertFalse(student.is_superuser)

            repeated = self.client.post('/api/users/import/confirm/', {
                'role': 'student',
                'file': self.xlsx_file(headers, rows),
            }, format='multipart')
            self.assertEqual(repeated.status_code, 200, repeated.json())
            self.assertEqual(repeated.json()['successfully_imported'], 0)
            self.assertEqual(User.objects.filter(student_id='CUSTOM-STU-100').count(), 1)

        def test_instructor_csv_import_preserves_nfc_and_primary_section_assignment(self):
            self.client.force_authenticate(user=self.admin)
            csv_content = (
                'Instructor/Employee ID,First Name,Last Name,Email,Contact Number,Assigned Sections,Account Status\n'
                'CUSTOM-INS-100,Rae,Santos,rae.custom@example.com,09170000003,IMPORT-SEC-1,Active\n'
            )
            uploaded_file = SimpleUploadedFile('custom-instructors.csv', csv_content.encode(), content_type='text/csv')
            preview = self.client.post('/api/users/import/preview/', {
                'role': 'instructor',
                'file': uploaded_file,
            }, format='multipart')

            self.assertEqual(preview.status_code, 200, preview.json())
            self.assertEqual(preview.json()['valid_rows'], 1)
            self.assertFalse(User.objects.filter(instructor_id='CUSTOM-INS-100').exists())

            confirmed = self.client.post('/api/users/import/confirm/', {
                'role': 'instructor',
                'file': SimpleUploadedFile('custom-instructors.csv', csv_content.encode(), content_type='text/csv'),
            }, format='multipart')

            self.assertEqual(confirmed.status_code, 201, confirmed.json())
            instructor = User.objects.get(instructor_id='CUSTOM-INS-100')
            self.assertEqual(instructor.contact_number, '09170000003')
            self.assertTrue(instructor.assigned_sections.filter(pk=self.section.pk).exists())
            self.assertEqual(Section.objects.get(pk=self.section.pk).instructor, self.primary_instructor)
            self.assertIsNone(instructor.nfc_uid)
            self.assertFalse(instructor.has_usable_password())
            self.assertFalse(instructor.is_staff)
            self.assertFalse(instructor.is_superuser)

        def test_templates_support_both_formats_and_only_student_or_instructor_roles(self):
            self.client.force_authenticate(user=self.admin)

            student_xlsx = self.client.get('/api/users/import/template/?role=student&file_format=xlsx')
            instructor_csv = self.client.get('/api/users/import/template/?role=instructor&file_format=csv')
            instructor_xlsx = self.client.get('/api/users/import/template/?role=instructor&file_format=xlsx')
            admin_template = self.client.get('/api/users/import/template/?role=admin&file_format=xlsx')

            self.assertEqual(student_xlsx.status_code, 200)
            self.assertIn('student-import-template.xlsx', student_xlsx['Content-Disposition'])
            student_workbook = load_workbook(BytesIO(student_xlsx.content), read_only=True, data_only=True)
            student_sheet = student_workbook.active
            student_headers = tuple(next(student_sheet.iter_rows(min_row=7, max_row=7, values_only=True)))
            self.assertEqual(student_sheet['A1'].value, 'TapTrack Student Import Template')
            self.assertIn('Required: student_id, first_name, last_name, email.', student_sheet['A3'].value)
            self.assertIn('Optional: section.', student_sheet['A4'].value)
            student_workbook.close()
            self.assertEqual(student_headers, (
                'student_id (required)', 'first_name (required)', 'last_name (required)',
                'email (required)', 'section (optional)',
            ))
            self.assertEqual(instructor_csv.status_code, 200)
            template_text = instructor_csv.content.decode('utf-8-sig')
            self.assertEqual(template_text.strip(), 'instructor_id,first_name,last_name,email,sections')
            self.assertEqual(instructor_xlsx.status_code, 200)
            instructor_workbook = load_workbook(BytesIO(instructor_xlsx.content), read_only=True, data_only=True)
            instructor_sheet = instructor_workbook.active
            instructor_headers = tuple(next(instructor_sheet.iter_rows(min_row=7, max_row=7, values_only=True)))
            self.assertIn('Required: instructor_id, first_name, last_name, email.', instructor_sheet['A3'].value)
            self.assertIn('BSIT-1A;BSIT-1B;BSIT-2A', instructor_sheet['A5'].value)
            instructor_workbook.close()
            self.assertEqual(instructor_headers, (
                'instructor_id (required)', 'first_name (required)', 'last_name (required)',
                'email (required)', 'sections (optional)',
            ))
            self.assertEqual(admin_template.status_code, 400)

        def test_styled_student_and_instructor_workbooks_round_trip_through_preview(self):
            self.client.force_authenticate(user=self.admin)
            student_template = self.client.get('/api/users/import/template/?role=student&file_format=xlsx')
            student_workbook = load_workbook(BytesIO(student_template.content))
            student_workbook.active.append([
                'STYLED-STU-100', 'Avery', 'Workbook', 'avery.styled@example.com', '',
            ])
            student_data = BytesIO()
            student_workbook.save(student_data)
            student_workbook.close()
            student_preview = self.client.post('/api/users/import/preview/', {
                'role': 'student',
                'file': SimpleUploadedFile('styled-students.xlsx', student_data.getvalue()),
            }, format='multipart')

            self.assertEqual(student_preview.status_code, 200, student_preview.json())
            self.assertEqual(student_preview.json()['valid_rows'], 1)
            self.assertEqual(student_preview.json()['rows'][0]['sections'], [])
            self.assertFalse(User.objects.filter(student_id='STYLED-STU-100').exists())

            instructor_template = self.client.get('/api/users/import/template/?role=instructor&file_format=xlsx')
            instructor_workbook = load_workbook(BytesIO(instructor_template.content))
            instructor_workbook.active.append([
                'STYLED-INS-100', 'Rae', 'Workbook', 'rae.styled@example.com', 'IMPORT-SEC-1',
            ])
            instructor_data = BytesIO()
            instructor_workbook.save(instructor_data)
            instructor_workbook.close()
            instructor_preview = self.client.post('/api/users/import/preview/', {
                'role': 'instructor',
                'file': SimpleUploadedFile('styled-instructors.xlsx', instructor_data.getvalue()),
            }, format='multipart')

            self.assertEqual(instructor_preview.status_code, 200, instructor_preview.json())
            self.assertEqual(instructor_preview.json()['valid_rows'], 1)
            self.assertEqual(instructor_preview.json()['rows'][0]['sections'], ['Import Section One'])
            self.assertFalse(User.objects.filter(instructor_id='STYLED-INS-100').exists())

        def test_multiple_student_files_combine_simple_required_and_optional_section_rows(self):
            self.client.force_authenticate(user=self.admin)
            first_content = (
                b'student_id,first_name,last_name,email\n'
                b'MULTI-STU-100,Avery,Example,avery.multi@example.com\n'
            )
            second_content = (
                b'student_id,first_name,last_name,email,section\n'
                b'MULTI-STU-101,Casey,Example,casey.multi@example.com,IMPORT-SEC-1\n'
            )
            first_file = SimpleUploadedFile(
                'students-no-section.csv',
                first_content,
                content_type='text/csv',
            )
            second_file = SimpleUploadedFile(
                'students-with-section.csv',
                second_content,
                content_type='text/csv',
            )

            preview = self.client.post('/api/users/import/preview/', {
                'role': 'student',
                'files': [first_file, second_file],
            }, format='multipart')

            self.assertEqual(preview.status_code, 200, preview.json())
            self.assertEqual(preview.json()['total_rows'], 2)
            self.assertEqual(preview.json()['valid_rows'], 2)
            self.assertEqual(preview.json()['rows'][0]['sections'], [])
            self.assertEqual(preview.json()['rows'][1]['sections'], ['Import Section One'])
            self.assertFalse(User.objects.filter(student_id__in=['MULTI-STU-100', 'MULTI-STU-101']).exists())

            confirmed = self.client.post('/api/users/import/confirm/', {
                'role': 'student',
                'files': [
                    SimpleUploadedFile('students-no-section.csv', first_content, content_type='text/csv'),
                    SimpleUploadedFile('students-with-section.csv', second_content, content_type='text/csv'),
                ],
            }, format='multipart')

            self.assertEqual(confirmed.status_code, 201, confirmed.json())
            self.assertEqual(confirmed.json()['successfully_imported'], 2)
            students = list(User.objects.filter(student_id__in=['MULTI-STU-100', 'MULTI-STU-101']).order_by('student_id'))
            self.assertIsNone(students[0].section)
            self.assertEqual(students[1].section, self.section)
            self.assertTrue(all(student.has_usable_password() is False and student.nfc_uid is None for student in students))

        def test_multiple_instructor_files_assign_semicolon_sections_and_allow_blank_sections(self):
            self.client.force_authenticate(user=self.admin)
            second_section = Section.objects.create(
                subject_code='IMPORT-SEC-2',
                section_name='Import Section Two',
                instructor=self.primary_instructor,
            )
            first_content = (
                b'instructor_id,first_name,last_name,email,sections\n'
                b'MULTI-INS-100,Rae,Santos,rae.multi@example.com,IMPORT-SEC-1;IMPORT-SEC-2\n'
            )
            second_content = (
                b'instructor_id,first_name,last_name,email\n'
                b'MULTI-INS-101,Sam,Lee,sam.multi@example.com\n'
            )
            preview = self.client.post('/api/users/import/preview/', {
                'role': 'instructor',
                'files': [
                    SimpleUploadedFile('instructors-sections.csv', first_content, content_type='text/csv'),
                    SimpleUploadedFile('instructors-no-sections.csv', second_content, content_type='text/csv'),
                ],
            }, format='multipart')

            self.assertEqual(preview.status_code, 200, preview.json())
            self.assertEqual(preview.json()['valid_rows'], 2)
            self.assertEqual(preview.json()['rows'][0]['sections'], ['Import Section One', 'Import Section Two'])
            self.assertEqual(preview.json()['rows'][1]['sections'], [])
            self.assertEqual(preview.json()['rows'][1]['file'], 'instructors-no-sections.csv')

            confirmed = self.client.post('/api/users/import/confirm/', {
                'role': 'instructor',
                'files': [
                    SimpleUploadedFile('instructors-sections.csv', first_content, content_type='text/csv'),
                    SimpleUploadedFile('instructors-no-sections.csv', second_content, content_type='text/csv'),
                ],
            }, format='multipart')

            self.assertEqual(confirmed.status_code, 201, confirmed.json())
            first = User.objects.get(instructor_id='MULTI-INS-100')
            second = User.objects.get(instructor_id='MULTI-INS-101')
            self.assertEqual(set(first.assigned_sections.values_list('pk', flat=True)), {self.section.pk, second_section.pk})
            self.assertFalse(second.assigned_sections.exists())
            self.assertEqual(self.section.instructor, self.primary_instructor)
            self.assertEqual(second_section.instructor, self.primary_instructor)
            self.assertIsNone(first.nfc_uid)
            self.assertFalse(first.has_usable_password())

        def test_batch_preview_marks_cross_file_duplicates_and_invalid_rows_without_writing(self):
            self.client.force_authenticate(user=self.admin)
            first_content = (
                b'student_id,first_name,last_name,email,section\n'
                b'DUP-BATCH-100,Avery,Valid,dup.batch@example.com,\n'
            )
            second_content = (
                b'student_id,first_name,last_name,email,section\n'
                b'DUP-BATCH-100,Casey,Duplicate,casey.duplicate@example.com,\n'
                b'DUP-BATCH-101,Robin,Duplicate,dup.batch@example.com,\n'
                b'BAD-BATCH-102,Jamie,Invalid,not-an-email,\n'
                b',Missing,Identifier,missing.identifier@example.com,Unknown Section\n'
            )
            preview = self.client.post('/api/users/import/preview/', {
                'role': 'student',
                'files': [
                    SimpleUploadedFile('batch-one.csv', first_content, content_type='text/csv'),
                    SimpleUploadedFile('batch-two.csv', second_content, content_type='text/csv'),
                ],
            }, format='multipart')

            self.assertEqual(preview.status_code, 200, preview.json())
            payload = preview.json()
            self.assertEqual(payload['valid_rows'], 1)
            self.assertEqual(payload['duplicate_rows'], 2)
            self.assertEqual(payload['invalid_rows'], 2)
            self.assertEqual(payload['rows'][1]['file'], 'batch-two.csv')
            self.assertIn('valid email', ' '.join(error['message'] for error in payload['errors']))
            self.assertIn('No existing Section', ' '.join(error['message'] for error in payload['errors']))
            self.assertFalse(User.objects.filter(student_id__startswith='DUP-BATCH-').exists())
            self.assertFalse(User.objects.filter(student_id='BAD-BATCH-102').exists())

        def test_import_endpoints_reject_students_and_instructors(self):
            student = User.objects.create_user(
                username='custom-import-student',
                email='custom-import-student@example.com',
                password='StudentPassword-123',
                role=User.RoleChoices.STUDENT,
                student_id='CUSTOM-IMPORT-STUDENT',
            )
            self.client.force_authenticate(user=student)
            student_response = self.client.get('/api/users/import/template/?role=student')
            self.assertEqual(student_response.status_code, 403)

            self.client.force_authenticate(user=self.primary_instructor)
            instructor_response = self.client.post('/api/users/import/preview/', {}, format='multipart')
            self.assertEqual(instructor_response.status_code, 403)


CustomAdminUserImportAPITests = StudentWorkbookImportTests.CustomAdminUserImportAPITests


class InstructorAccessLogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='access-log-instructor',
            email='access-log-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='ACCESS-LOG-INSTRUCTOR',
            nfc_uid='INSTRUCTOR-ACCESS-UID',
        )
        self.section_a = Section.objects.create(section_name='Log Section A', instructor=self.instructor)
        self.section_b = Section.objects.create(section_name='Log Section B')
        self.section_b.assigned_instructors.add(self.instructor)
        self.unrelated_section = Section.objects.create(section_name='Unrelated Log Section')
        self.student_a = User.objects.create_user(
            username='access-log-student-a',
            email='access-log-student-a@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='LOG-STUDENT-A',
            first_name='Casey',
            last_name='Alpha',
            section=self.section_a,
            nfc_uid='STUDENT-ACCESS-UID-A',
        )
        self.student_b = User.objects.create_user(
            username='access-log-student-b',
            email='access-log-student-b@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='LOG-STUDENT-B',
            first_name='Jordan',
            last_name='Beta',
            section=self.section_b,
            nfc_uid='STUDENT-ACCESS-UID-B',
        )
        self.outside_student = User.objects.create_user(
            username='access-log-outside-student',
            email='access-log-outside-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='LOG-STUDENT-OUTSIDE',
            section=self.unrelated_section,
            nfc_uid='OUTSIDE-ACCESS-UID',
        )
        now = timezone.now()
        self.success_log = self.create_log(
            self.student_a,
            AccessLog.AccessStatusChoices.SUCCESS,
            nfc_uid='AA11BB22',
            station='Reader 1',
            cabinet_name='Cabinet Alpha',
            reason='NFC verified successfully',
            access_time=now,
        )
        self.rejected_log = self.create_log(
            self.student_b,
            AccessLog.AccessStatusChoices.REJECTED,
            nfc_uid='',
            station='Reader 2',
            cabinet_name='',
            reason='',
            access_time=now,
        )
        self.duplicate_log = self.create_log(
            self.student_b,
            AccessLog.AccessStatusChoices.DUPLICATE,
            nfc_uid='CC33DD44',
            station='Reader 2',
            cabinet_name='Cabinet Gamma',
            reason='Duplicate participant scan',
            access_time=now,
        )
        self.old_log = self.create_log(
            self.student_a,
            AccessLog.AccessStatusChoices.SUCCESS,
            nfc_uid='EE55FF66',
            station='Reader 1',
            cabinet_name='Cabinet Old',
            reason='NFC verified successfully',
            access_time=now - timedelta(days=2),
        )
        self.outside_log = self.create_log(
            self.outside_student,
            AccessLog.AccessStatusChoices.SUCCESS,
            nfc_uid='OUTSIDE-UID',
            station='Reader Outside',
            cabinet_name='Cabinet Outside',
            reason='NFC verified successfully',
            access_time=now,
        )
        AccessLogPhoto.objects.create(
            access_log=self.success_log,
            capture_status=AccessLogPhoto.CaptureStatusChoices.SUCCESS,
            captured_at=now,
        )
        AccessLogPhoto.objects.create(
            access_log=self.duplicate_log,
            capture_status=AccessLogPhoto.CaptureStatusChoices.FAILED,
            diagnostic_error='Camera unavailable',
        )

    def create_log(self, user, status, **fields):
        access_time = fields.pop('access_time')
        log = AccessLog.objects.create(user=user, status=status, **fields)
        log.access_time = access_time
        log.save(update_fields=['access_time'])
        return log

    def setUpInstructor(self):
        self.client.force_authenticate(user=self.instructor)

    def test_instructor_access_logs_serialize_actual_record_and_limit_scope(self):
        self.setUpInstructor()

        response = self.client.get('/api/access-logs/?page_size=25')

        self.assertEqual(response.status_code, 200, response.json())
        results = response.json()['results']
        self.assertEqual({entry['id'] for entry in results}, {
            self.success_log.pk,
            self.rejected_log.pk,
            self.duplicate_log.pk,
            self.old_log.pk,
        })
        serialized = next(entry for entry in results if entry['id'] == self.success_log.pk)
        self.assertEqual(serialized['student_id'], 'LOG-STUDENT-A')
        self.assertEqual(serialized['student_name'], 'Casey Alpha')
        self.assertEqual(serialized['section_name'], 'Log Section A')
        self.assertNotIn('nfc_uid', serialized)
        self.assertEqual(serialized['cabinet_name'], 'Cabinet Alpha')
        self.assertEqual(serialized['station'], 'Reader 1')
        self.assertEqual(serialized['access_result'], 'Success')
        self.assertEqual(serialized['photo_capture_status'], 'success')
        self.assertNotIn('image_endpoint', serialized)

        failed = next(entry for entry in results if entry['id'] == self.rejected_log.pk)
        self.assertEqual(failed['access_result'], 'Failed')
        self.assertNotIn('nfc_uid', failed)
        self.assertEqual(failed['cabinet_name'], '')
        self.assertEqual(failed['reason'], '')
        self.assertEqual(next(entry for entry in results if entry['id'] == self.duplicate_log.pk)['reason'], 'Duplicate participant scan')

    def test_instructor_profile_and_student_details_omit_all_nfc_uids(self):
        self.setUpInstructor()

        profile_response = self.client.get('/api/users/profile/')
        students_response = self.client.get('/api/users/?role=student')
        student_details_response = self.client.get(f'/api/users/{self.student_a.pk}/profile-details/')

        self.assertEqual(profile_response.status_code, 200, profile_response.json())
        self.assertEqual(students_response.status_code, 200, students_response.json())
        self.assertEqual(student_details_response.status_code, 200, student_details_response.json())

        def assert_uid_omitted(payload):
            if isinstance(payload, dict):
                self.assertNotIn('nfc_uid', payload)
                for value in payload.values():
                    assert_uid_omitted(value)
            elif isinstance(payload, list):
                for value in payload:
                    assert_uid_omitted(value)

        assert_uid_omitted(profile_response.json())
        assert_uid_omitted(students_response.json())
        assert_uid_omitted(student_details_response.json())

    def test_instructor_filters_cover_failure_groups_search_dates_sections_and_pages(self):
        self.setUpInstructor()
        today = timezone.localdate().isoformat()

        failed_response = self.client.get('/api/access-logs/?status=failed&page_size=25')
        self.assertEqual(failed_response.status_code, 200, failed_response.json())
        self.assertEqual(
            {entry['id'] for entry in failed_response.json()['results']},
            {self.rejected_log.pk, self.duplicate_log.pk},
        )
        success_response = self.client.get(f'/api/access-logs/?status=success&access_time_after={today}&access_time_before={today}')
        self.assertEqual([entry['id'] for entry in success_response.json()['results']], [self.success_log.pk])

        cabinet_search = self.client.get('/api/access-logs/?search=Gamma')
        self.assertEqual([entry['id'] for entry in cabinet_search.json()['results']], [self.duplicate_log.pk])
        name_search = self.client.get('/api/access-logs/?search=Casey Alpha')
        self.assertEqual(
            {entry['id'] for entry in name_search.json()['results']},
            {self.success_log.pk, self.old_log.pk},
        )
        nfc_search = self.client.get('/api/access-logs/?search=AA11BB22')
        self.assertEqual(nfc_search.json()['results'], [])
        nfc_filter = self.client.get('/api/access-logs/?nfc_uid=AA11BB22')
        self.assertEqual({entry['id'] for entry in nfc_filter.json()['results']}, {
            self.success_log.pk, self.rejected_log.pk, self.duplicate_log.pk, self.old_log.pk,
        })
        section_response = self.client.get(f'/api/access-logs/?user__section={self.section_b.pk}')
        self.assertEqual(
            {entry['id'] for entry in section_response.json()['results']},
            {self.rejected_log.pk, self.duplicate_log.pk},
        )
        photo_response = self.client.get('/api/access-logs/?photo_capture_status=failed')
        self.assertEqual(photo_response.status_code, 200, photo_response.json())
        self.assertEqual([entry['id'] for entry in photo_response.json()['results']], [self.duplicate_log.pk])
        date_response = self.client.get(f'/api/access-logs/?access_time_after={today}&access_time_before={today}')
        self.assertEqual(
            {entry['id'] for entry in date_response.json()['results']},
            {self.success_log.pk, self.rejected_log.pk, self.duplicate_log.pk},
        )
        one_item_page = self.client.get('/api/access-logs/?page_size=1&page=2')
        self.assertEqual(one_item_page.json()['count'], 4)
        self.assertEqual(len(one_item_page.json()['results']), 1)

    def test_cabinet_filter_options_are_instructor_and_section_scoped(self):
        self.setUpInstructor()

        all_options = self.client.get('/api/access-logs/filter-options/')
        self.assertEqual(all_options.status_code, 200, all_options.json())
        self.assertEqual(set(all_options.json()['cabinets']), {'Cabinet Alpha', 'Cabinet Gamma', 'Cabinet Old'})

        section_options = self.client.get(f'/api/access-logs/filter-options/?user__section={self.section_b.pk}')
        self.assertEqual(section_options.json()['cabinets'], ['Cabinet Gamma'])

    def test_instructor_user_responses_omit_own_and_student_uids_but_admin_can_read_them(self):
        self.setUpInstructor()

        own_profile = self.client.get('/api/users/profile/')
        student_profile = self.client.get(f'/api/users/{self.student_a.pk}/')
        unrelated_profile = self.client.get(f'/api/users/{self.outside_student.pk}/')

        self.assertEqual(own_profile.status_code, 200, own_profile.json())
        self.assertEqual(student_profile.status_code, 200, student_profile.json())
        self.assertNotIn('nfc_uid', own_profile.json())
        self.assertNotIn('nfc_uid', student_profile.json())
        self.assertEqual(unrelated_profile.status_code, 404)

        admin = User.objects.create_user(
            username='access-log-admin',
            email='access-log-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        admin_student = self.client.get(f'/api/users/{self.student_a.pk}/')
        admin_log = self.client.get('/api/access-logs/?page_size=25')

        self.assertEqual(admin_student.json()['nfc_uid'], 'STUDENT-ACCESS-UID-A')
        self.assertEqual(next(item for item in admin_log.json()['results'] if item['id'] == self.success_log.pk)['nfc_uid'], 'AA11BB22')
        admin_uid_search = self.client.get('/api/access-logs/?search=AA11BB22')
        self.assertEqual([item['id'] for item in admin_uid_search.json()['results']], [self.success_log.pk])

    def test_cabinet_session_participant_uid_is_admin_only(self):
        session = CabinetSession.objects.create(station='Reader Session')
        session.opened_by.add(self.student_a)
        unrelated_session = CabinetSession.objects.create(station='Unrelated Reader Session')
        unrelated_session.opened_by.add(self.outside_student)
        self.setUpInstructor()

        instructor_response = self.client.get('/api/cabinet-sessions/')

        self.assertEqual(instructor_response.status_code, 200, instructor_response.json())
        instructor_session = next(item for item in instructor_response.json()['results'] if item['id'] == session.pk)
        self.assertNotIn('uid', instructor_session['opened_by'][0])
        self.assertNotIn(unrelated_session.pk, {item['id'] for item in instructor_response.json()['results']})

        admin = User.objects.create_user(
            username='session-uid-admin',
            email='session-uid-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        admin_response = self.client.get('/api/cabinet-sessions/')
        admin_results = {item['id']: item for item in admin_response.json()['results']}
        self.assertIn(unrelated_session.pk, admin_results)
        admin_session = admin_results[session.pk]
        self.assertEqual(admin_session['opened_by'][0]['uid'], 'STUDENT-ACCESS-UID-A')


class StudentAccessLogsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='student1',
            email='student1@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='One',
            student_id='S001',
        )
        self.other_student = User.objects.create_user(
            username='student2',
            email='student2@example.com',
            password='secret123',
            role='student',
            first_name='Student',
            last_name='Two',
            student_id='S002',
        )
        AccessLog.objects.create(user=self.student, status='success', cabinet_name='Cabinet A', reason='Entry granted', nfc_uid='ABC123')
        AccessLog.objects.create(user=self.other_student, status='failed', cabinet_name='Cabinet B', reason='Denied', nfc_uid='XYZ999')

    def test_student_only_sees_own_access_logs(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/access-logs/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        results = data.get('results', [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['cabinet_name'], 'Cabinet A')
        self.assertEqual(results[0]['user'], self.student.id)
        self.assertNotIn('nfc_uid', results[0])

        uid_search = self.client.get('/api/access-logs/?search=ABC123')
        self.assertEqual(uid_search.status_code, 200, uid_search.json())
        self.assertEqual(uid_search.json()['results'], [])

    def test_student_stats_endpoint_returns_private_totals(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/access-logs/stats/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['total_accesses_today'], 1)
        self.assertEqual(data['successful_accesses_today'], 1)
        self.assertEqual(data['failed_accesses_today'], 0)

    def test_student_dashboard_does_not_expose_nfc_uid(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/dashboard/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(response.json()['recent_access_logs'])
        self.assertTrue(all('nfc_uid' not in log for log in response.json()['recent_access_logs']))

    def test_access_logs_store_nfc_uid_and_cabinet_session(self):
        session = CabinetSession.objects.create(station='Station 1', status='open')
        session.opened_by.add(self.student)
        log = AccessLog.objects.create(
            user=self.student,
            nfc_uid='ABCD-1234',
            station='Station 1',
            action='open',
            status='success',
            reason='Cabinet session opened',
            cabinet_session=session,
        )

        self.assertEqual(log.nfc_uid, 'ABCD-1234')
        self.assertEqual(log.station, 'Station 1')
        self.assertEqual(log.cabinet_session_id, session.id)

    def test_access_log_api_rejects_client_created_audit_values(self):
        admin_user = User.objects.create_superuser(
            username='access-log-api-admin',
            email='access-log-api-admin@example.com',
            password='secret1234',
        )
        self.client.force_authenticate(user=admin_user)

        response = self.client.post('/api/access-logs/', {
            'user': self.student.pk,
            'status': 'success',
            'action': 'open',
            'nfc_uid': 'CLIENT-SUPPLIED',
            'station': 'Station 1',
            'cabinet_name': 'Cabinet 1',
            'reason': 'Forged audit data',
        }, format='json')

        self.assertEqual(response.status_code, 405)
        self.assertFalse(AccessLog.objects.filter(nfc_uid='CLIENT-SUPPLIED').exists())

    def test_access_log_admin_is_read_only(self):
        access_log_admin = AccessLogAdmin(model=AccessLog, admin_site=django_admin.site)
        admin_user = User.objects.create_superuser(
            username='access-log-admin',
            email='access-log-admin@example.com',
            password='secret1234',
        )
        request = RequestFactory().get('/admin/api/accesslog/')
        request.user = admin_user

        self.assertFalse(access_log_admin.has_add_permission(request))
        self.assertFalse(access_log_admin.has_change_permission(request))
        self.assertFalse(access_log_admin.has_delete_permission(request))
        self.assertTrue(access_log_admin.has_view_permission(request))
        self.assertEqual(access_log_admin.get_model_perms(request), {'view': True})
        self.assertTrue({
            'user', 'cabinet_session', 'access_time', 'status', 'action',
            'nfc_uid', 'station', 'cabinet_name', 'reason', 'updated_at',
        }.issubset(set(access_log_admin.get_readonly_fields(request))))

        session = CabinetSession.objects.create(station='Station 1', status=CabinetSession.StatusChoices.OPEN)
        log = AccessLog.objects.create(
            user=self.student,
            cabinet_session=session,
            access_time=timezone.now(),
            status='success',
            action='scan',
            nfc_uid='ABCD1234',
            station='Station 1',
            cabinet_name='Cabinet 1',
            reason='Original audit reason',
        )
        self.client.force_login(admin_user)
        response = self.client.get(reverse('admin:api_accesslog_change', args=[log.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'ABCD1234')
        self.assertContains(response, 'Original audit reason')

        response = self.client.post(reverse('admin:api_accesslog_change', args=[log.pk]), {
            'user': self.other_student.pk,
            'cabinet_session': '',
            'access_time': '2000-01-01 00:00:00',
            'status': 'failed',
            'action': 'open',
            'nfc_uid': 'OVERRIDE',
            'station': 'Station 2',
            'cabinet_name': 'Forged cabinet',
            'reason': 'Forged reason',
            'updated_at': '2000-01-01 00:00:00',
        })
        self.assertEqual(response.status_code, 403)
        log.refresh_from_db()
        self.assertEqual(log.user, self.student)
        self.assertEqual(log.cabinet_session, session)
        self.assertEqual(log.status, 'success')
        self.assertEqual(log.action, 'scan')
        self.assertEqual(log.nfc_uid, 'ABCD1234')
        self.assertEqual(log.station, 'Station 1')
        self.assertEqual(log.cabinet_name, 'Cabinet 1')
        self.assertEqual(log.reason, 'Original audit reason')


@override_settings(TAPTRACK_NFC_DEVICE_MAP=[
    {'device_id': 'CABINET1-STATION1', 'api_key': 'test-device-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True},
])
class PasswordChangeApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='password-change-student',
            email='password-change-student@example.com',
            password='Current-Password-123!',
            role=User.RoleChoices.STUDENT,
            student_id='PASS-CHANGE-001',
        )
        self.client.force_authenticate(self.user)

    def change_password(self, new_password='Updated-Password-456!', confirm_password=None, current_password='Current-Password-123!'):
        return self.client.post('/api/users/change_password/', {
            'current_password': current_password,
            'new_password': new_password,
            'confirm_password': confirm_password if confirm_password is not None else new_password,
        }, format='json')

    def test_correct_current_password_allows_successful_change(self):
        response = self.change_password()

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Updated-Password-456!'))

    def test_incorrect_current_password_is_rejected_without_changing_password(self):
        response = self.change_password(current_password='Wrong-Password-123!')

        self.assertEqual(response.status_code, 400)
        self.assertIn('current_password', response.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Current-Password-123!'))

    def test_reusing_current_password_is_rejected_without_changing_password(self):
        response = self.change_password(
            new_password='Current-Password-123!',
            confirm_password='Current-Password-123!',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('different from your current password', response.json()['new_password'][0])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Current-Password-123!'))

    def test_confirmation_mismatch_is_rejected_without_changing_password(self):
        response = self.change_password(confirm_password='Different-Password-789!')

        self.assertEqual(response.status_code, 400)
        self.assertIn('confirm_password', response.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Current-Password-123!'))

    def test_password_strength_policy_is_enforced(self):
        response = self.change_password(new_password='weakpassword', confirm_password='weakpassword')

        self.assertEqual(response.status_code, 400)
        self.assertIn('new_password', response.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Current-Password-123!'))


@override_settings(TAPTRACK_NFC_DEVICE_MAP=[
    {'device_id': 'CABINET1-STATION1', 'api_key': 'test-device-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True},
])
class PasswordResetFlowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.device_api_key = 'test-device-key'
        os.environ['DEVICE_API_KEY'] = self.device_api_key

        self.student_a = User.objects.create_user(
            username='student-a',
            email='student-a@example.com',
            password='old-password-1',
            role=User.RoleChoices.STUDENT,
            first_name='Student',
            last_name='A',
            student_id='STU-001',
            nfc_uid='NFC-USER-001',
        )
        self.student_b = User.objects.create_user(
            username='student-b',
            email='student-b@example.com',
            password='old-password-2',
            role=User.RoleChoices.STUDENT,
            first_name='Student',
            last_name='B',
            student_id='STU-002',
            nfc_uid='NFC-USER-002',
        )

    def test_cabinet_cancellation_updates_request_and_audit_once(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])

        first = self.client.post('/api/auth/password-reset/cancel/', {
            'request_id': reset_request.request_id,
        }, format='json')
        repeated = self.client.post('/api/auth/password-reset/cancel/', {
            'request_id': reset_request.request_id,
        }, format='json')

        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()['cancelled'])
        self.assertFalse(repeated.json()['cancelled'])
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.CANCELLED)
        cancellations = reset_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.REQUEST_CANCELLED,
            reason_code='cancelled_by_cabinet',
        )
        self.assertEqual(cancellations.count(), 1)

    def test_cabinet_queue_is_device_protected_and_masks_accounts(self):
        unauthenticated = self.client.get('/api/auth/password-reset/cabinet-queue/')
        self.assertEqual(unauthenticated.status_code, 403)

        for target in (self.student_a, self.student_b):
            response = self.client.post('/api/auth/password-reset/request/', {
                'student_id': target.student_id,
                'email': target.email,
            }, format='json')
            self.assertEqual(response.status_code, 200)

        queue = self.client.get(
            '/api/auth/password-reset/cabinet-queue/',
            HTTP_X_API_KEY=self.device_api_key,
        )
        self.assertEqual(queue.status_code, 200, queue.json())
        payload = queue.json()
        self.assertEqual(payload['count'], 2)
        by_reference = {item['account_reference'] for item in payload['results']}
        self.assertIn('•••-001', by_reference)
        self.assertIn('•••-002', by_reference)
        serialized = json.dumps(payload)
        self.assertNotIn('STU-001', serialized)
        self.assertNotIn('STU-002', serialized)
        self.assertNotIn('NFC-USER-', serialized)
        self.assertNotIn('reset_authorization', serialized)

    def test_wrong_card_is_audited_without_authorizing_request(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_b.student_id,
            'email': self.student_b.email,
        }, format='json')
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])
        handoff = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff.status_code, 200)

        mismatch = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(mismatch.status_code, 403)
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.PENDING)
        self.assertFalse(reset_request.nfc_uid_verified)

        rejection = reset_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.NFC_REJECTED,
        ).get()
        self.assertEqual(rejection.outcome, PasswordRecoveryAuditEvent.Outcome.FAILURE)
        self.assertEqual(rejection.reason_code, 'card_account_mismatch')
        self.assertFalse(reset_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.AUTHORIZATION_ISSUE,
        ).exists())

        recovery_admin = django_admin.site._registry[PasswordRecoveryAuditEvent]
        self.assertFalse(recovery_admin.has_add_permission(RequestFactory().get('/')))
        self.assertFalse(recovery_admin.has_change_permission(RequestFactory().get('/')))
        self.assertFalse(recovery_admin.has_delete_permission(RequestFactory().get('/')))

    def test_password_reset_request_is_bound_to_user_and_status_issues_authorization_after_nfc(self):
        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-001',
            'email': 'student-a@example.com',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertIn('request_id', payload)
        self.assertNotIn('user_id', payload)

        reset_request = PasswordResetRequest.objects.get(request_id=payload['request_id'])
        self.assertEqual(reset_request.user_id, self.student_a.pk)

        pending_response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')
        self.assertEqual(pending_response.status_code, 200)
        self.assertEqual(pending_response.json(), {'status': 'pending'})
        self.assertNotIn('reset_authorization', pending_response.json())

        handoff_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff_response.status_code, 200, handoff_response.json())
        self.assertNotIn('student_id', handoff_response.json())

        verify_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': 'NFC-USER-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(verify_response.status_code, 200, verify_response.json())
        verify_payload = verify_response.json()
        self.assertNotIn('reset_token', verify_payload)

        validation_response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')

        self.assertEqual(validation_response.status_code, 200, validation_response.json())
        validation_payload = validation_response.json()
        self.assertEqual(validation_payload['status'], 'verified')
        self.assertIn('reset_authorization', validation_payload)
        repeated_poll = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')
        self.assertEqual(repeated_poll.json()['reset_authorization'], validation_payload['reset_authorization'])

        confirm_response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': validation_payload['reset_authorization'],
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!',
        }, format='json')

        self.assertEqual(confirm_response.status_code, 200, confirm_response.json())
        self.student_a.refresh_from_db()
        self.assertTrue(self.student_a.check_password('NewPassword123!'))

        login_response = self.client.post('/api/auth/login/', {
            'username': self.student_a.username,
            'password': 'NewPassword123!',
            'expected_role': 'student',
        }, format='json')
        self.assertEqual(login_response.status_code, 200, login_response.json())

    def test_valid_and_invalid_account_requests_have_generic_same_shape(self):
        valid_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-001',
            'email': 'student-a@example.com',
        }, format='json')
        invalid_responses = [
            self.client.post('/api/auth/password-reset/request/', {
                'student_id': 'STU-001',
                'email': self.student_b.email,
            }, format='json'),
            self.client.post('/api/auth/password-reset/request/', {
                'student_id': 'UNKNOWN-STUDENT',
                'email': 'student-a@example.com',
            }, format='json'),
            self.client.post('/api/auth/password-reset/request/', {
                'student_id': 'UNKNOWN-STUDENT',
                'email': 'other@example.com',
            }, format='json'),
        ]

        self.assertEqual(valid_response.status_code, 200)
        for invalid_response in invalid_responses:
            self.assertEqual(valid_response.status_code, invalid_response.status_code)
            self.assertEqual(set(valid_response.json()), set(invalid_response.json()))
            self.assertEqual(valid_response.json()['message'], invalid_response.json()['message'])
            self.assertNotEqual(valid_response.json()['request_id'], invalid_response.json()['request_id'])
            self.assertNotIn('user_id', invalid_response.json())
            invalid_reset_request = PasswordResetRequest.objects.get(
                request_id=invalid_response.json()['request_id'],
            )
            self.assertIsNone(invalid_reset_request.user_id)
            pending = self.client.post('/api/auth/password-reset/status/', {
                'request_id': invalid_reset_request.request_id,
            }, format='json')
            self.assertEqual(pending.json(), {'status': 'pending'})

        valid_reset_request = PasswordResetRequest.objects.get(request_id=valid_response.json()['request_id'])
        invalid_reset_requests = PasswordResetRequest.objects.filter(
            request_id__in=[response.json()['request_id'] for response in invalid_responses],
        )
        queue = self.client.get(
            '/api/auth/password-reset/cabinet-queue/',
            HTTP_X_API_KEY=self.device_api_key,
        )
        self.assertEqual(queue.status_code, 200, queue.json())
        self.assertEqual([item['request_id'] for item in queue.json()['results']], [valid_reset_request.request_id])
        self.assertEqual(invalid_reset_requests.count(), len(invalid_responses))
        past = timezone.now() - timedelta(minutes=1)
        PasswordResetRequest.objects.filter(
            pk__in=[valid_reset_request.pk, *invalid_reset_requests.values_list('pk', flat=True)],
        ).update(expires_at=past)
        valid_expired = self.client.post('/api/auth/password-reset/status/', {
            'request_id': valid_reset_request.request_id,
        }, format='json')
        for invalid_response in invalid_responses:
            invalid_expired = self.client.post('/api/auth/password-reset/status/', {
                'request_id': invalid_response.json()['request_id'],
            }, format='json')
            self.assertEqual(valid_expired.status_code, invalid_expired.status_code)
            self.assertEqual(valid_expired.json(), invalid_expired.json())

    def test_student_without_registered_nfc_card_gets_generic_nonselectable_request(self):
        no_card_student = User.objects.create_user(
            username='student-no-nfc',
            email='student-no-nfc@example.com',
            password='old-password-3',
            role=User.RoleChoices.STUDENT,
            first_name='Student',
            last_name='No Card',
            student_id='STU-NO-CARD',
            nfc_uid=None,
        )

        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': no_card_student.student_id,
            'email': no_card_student.email,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(
            response.json()['message'],
            'If the supplied details match an eligible account, continue verification at the cabinet.',
        )
        decoy_request = PasswordResetRequest.objects.get(request_id=response.json()['request_id'])
        self.assertIsNone(decoy_request.user_id)
        queue = self.client.get(
            '/api/auth/password-reset/cabinet-queue/',
            HTTP_X_API_KEY=self.device_api_key,
        )
        self.assertEqual(queue.status_code, 200, queue.json())
        self.assertNotIn(response.json()['request_id'], [item['request_id'] for item in queue.json()['results']])

    def test_password_reset_request_rejects_missing_and_malformed_fields(self):
        invalid_payloads = [
            {},
            {'student_id': '', 'email': 'student-a@example.com'},
            {'student_id': 'STU-001'},
            {'student_id': ['STU-001'], 'email': 'student-a@example.com'},
            {'student_id': 'STU-001', 'email': ['student-a@example.com']},
            {'student_id': '   ', 'email': 'student-a@example.com'},
            {'student_id': 'STU-001', 'email': 'not-an-email'},
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.post(
                    '/api/auth/password-reset/request/',
                    payload,
                    format='json',
                )

                self.assertEqual(response.status_code, 400, response.json())
                self.assertTrue(isinstance(response.json(), dict))

        self.assertFalse(PasswordResetRequest.objects.exists())

    def test_invalid_account_details_do_not_leak_through_cabinet_handoff(self):
        valid_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-001',
            'email': 'student-a@example.com',
        }, format='json')
        invalid_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-001',
            'email': 'wrong@example.com',
        }, format='json')

        handoff_responses = [
            self.client.post('/api/auth/password-reset/cabinet-handoff/', {
                'request_id': response.json()['request_id'],
            }, HTTP_X_API_KEY=self.device_api_key, format='json')
            for response in (valid_response, invalid_response)
        ]

        self.assertEqual([response.status_code for response in handoff_responses], [200, 200])
        self.assertEqual(
            [set(response.json()) for response in handoff_responses],
            [{'request_id', 'expires_at'}, {'request_id', 'expires_at'}],
        )
        repeated_handoffs = [
            self.client.post('/api/auth/password-reset/cabinet-handoff/', {
                'request_id': response.json()['request_id'],
            }, HTTP_X_API_KEY=self.device_api_key, format='json')
            for response in (valid_response, invalid_response)
        ]
        self.assertEqual([response.status_code for response in repeated_handoffs], [200, 200])

        invalid_request_id = invalid_response.json()['request_id']
        invalid_verification = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': invalid_request_id,
            'nfc_uid': 'NFC-USER-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(invalid_verification.status_code, 404)

        pending = self.client.post('/api/auth/password-reset/status/', {
            'request_id': invalid_request_id,
        }, format='json')
        self.assertEqual(pending.json(), {'status': 'pending'})

    def test_nfc_verification_requires_exact_owner_and_does_not_accept_student_id(self):
        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-002',
            'email': 'student-b@example.com',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        reset_request = PasswordResetRequest.objects.get(request_id=response.json()['request_id'])

        handoff_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff_response.status_code, 200, handoff_response.json())

        mismatched_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': 'NFC-USER-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(mismatched_response.status_code, 403, mismatched_response.json())
        self.assertIn('does not match', mismatched_response.json()['error'])
        correct_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': 'NFC-USER-002',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(correct_response.status_code, 200, correct_response.json())
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.VERIFIED)
        verified_event = reset_request.audit_events.get(
            event_type=PasswordRecoveryAuditEvent.EventType.NFC_VERIFIED,
        )
        self.assertEqual(verified_event.outcome, PasswordRecoveryAuditEvent.Outcome.SUCCESS)
        self.assertEqual(verified_event.actor_type, PasswordRecoveryAuditEvent.ActorType.PI)

        duplicate_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': 'NFC-USER-002',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(duplicate_response.status_code, 409, duplicate_response.json())
        self.assertEqual(reset_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.NFC_VERIFIED,
        ).count(), 1)

    def test_nfc_verification_normalizes_legacy_stored_uid(self):
        self.student_b.nfc_uid = ' nfc-user-002 '
        self.student_b.save(update_fields=['nfc_uid'])
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_b.student_id,
            'email': self.student_b.email,
        }, format='json')
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])
        handoff = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff.status_code, 200, handoff.json())

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': 'NFC-USER-002',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 200, response.json())

    def test_nfc_verification_rejects_expired_cancelled_and_used_requests(self):
        for target_index, terminal_status in enumerate((
            PasswordResetRequest.StatusChoices.CANCELLED,
            PasswordResetRequest.StatusChoices.USED,
        )):
            with self.subTest(status=terminal_status):
                target = self.student_a if target_index == 0 else self.student_b
                request_response = self.client.post('/api/auth/password-reset/request/', {
                    'student_id': target.student_id,
                    'email': target.email,
                }, format='json')
                reset_request = PasswordResetRequest.objects.get(
                    request_id=request_response.json()['request_id'],
                )
                handoff = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
                    'request_id': reset_request.request_id,
                }, HTTP_X_API_KEY=self.device_api_key, format='json')
                self.assertEqual(handoff.status_code, 200, handoff.json())
                reset_request.status = terminal_status
                reset_request.expires_at = timezone.now() - timedelta(minutes=1)
                reset_request.save(update_fields=['status', 'expires_at'])

                response = self.client.post('/api/auth/password-reset/verify-nfc/', {
                    'request_id': reset_request.request_id,
                    'nfc_uid': target.nfc_uid,
                }, HTTP_X_API_KEY=self.device_api_key, format='json')
                self.assertEqual(response.status_code, 409, response.json())
                reset_request.refresh_from_db()
                self.assertEqual(reset_request.status, terminal_status)

        expired_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        expired_request = PasswordResetRequest.objects.get(
            request_id=expired_response.json()['request_id'],
        )
        handoff = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': expired_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff.status_code, 200, handoff.json())
        expired_request.expires_at = timezone.now() - timedelta(minutes=1)
        expired_request.save(update_fields=['expires_at'])

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': expired_request.request_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 410, response.json())
        expired_request.refresh_from_db()
        self.assertEqual(expired_request.status, PasswordResetRequest.StatusChoices.EXPIRED)
        self.assertEqual(expired_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.REQUEST_EXPIRED,
        ).count(), 1)

        repeated_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': expired_request.request_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(repeated_response.status_code, 410)
        self.assertEqual(expired_request.audit_events.filter(
            event_type=PasswordRecoveryAuditEvent.EventType.REQUEST_EXPIRED,
        ).count(), 1)

    def _create_verified_reset_request(self, user=None):
        target = user or self.student_a
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': target.student_id,
            'email': target.email,
        }, format='json')
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])
        handoff_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        if handoff_response.status_code != 200:
            raise AssertionError(handoff_response.json())
        verify_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': target.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        if verify_response.status_code != 200:
            raise AssertionError(verify_response.json())
        return reset_request, verify_response

    def _create_reset_authorization(self, user=None):
        reset_request, _ = self._create_verified_reset_request(user)
        status_response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')
        if status_response.status_code != 200:
            raise AssertionError(status_response.json())
        return reset_request, status_response.json()['reset_authorization']

    def _confirm_reset(self, reset_request, authorization, new_password, confirm_password=None):
        return self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': authorization,
            'new_password': new_password,
            'confirm_password': confirm_password if confirm_password is not None else new_password,
        }, format='json')

    def test_password_reset_uses_configured_password_validators_and_keeps_authorization_after_failures(self):
        reset_request, authorization = self._create_reset_authorization()
        invalid_passwords = (
            ('short', 'Ab1!', 'at least 8 characters'),
            ('similar to username', 'student-a', 'too similar'),
            ('commonly used', 'password', 'too common'),
            ('numeric only', '12345678', 'entirely numeric'),
            ('reuse current hash', 'old-password-1', 'different from your current password'),
        )

        for label, password, expected_message in invalid_passwords:
            with self.subTest(password_rule=label):
                response = self._confirm_reset(reset_request, authorization, password)
                self.assertEqual(response.status_code, 400, response.json())
                self.assertIn('new_password', response.json())
                self.assertIn(expected_message, ' '.join(response.json()['new_password']).lower())
                reset_request.refresh_from_db()
                self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.VERIFIED)
                self.assertIsNone(reset_request.reset_authorization_used_at)
                self.assertTrue(self.student_a.check_password('old-password-1'))

        success = self._confirm_reset(reset_request, authorization, 'Updated-Password-456!')
        self.assertEqual(success.status_code, 200, success.json())
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.USED)
        self.assertIsNotNone(reset_request.used_at)
        self.student_a.refresh_from_db()
        self.assertTrue(self.student_a.check_password('Updated-Password-456!'))

    def test_password_reset_mismatch_is_inline_validation_and_does_not_consume_authorization(self):
        reset_request, authorization = self._create_reset_authorization()

        response = self._confirm_reset(
            reset_request,
            authorization,
            'Updated-Password-456!',
            'Different-Password-789!',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('confirm_password', response.json())
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.VERIFIED)
        self.assertIsNone(reset_request.reset_authorization_used_at)

    def test_password_reset_admin_history_is_read_only_scoped_and_hides_credentials(self):
        reset_request, authorization = self._create_reset_authorization()
        reset_request.reset_authorization_hash = make_password(authorization)
        reset_request.reset_authorization_nonce = 'private-reset-nonce'
        reset_request.save(update_fields=['reset_authorization_hash', 'reset_authorization_nonce'])
        PasswordRecoveryAuditEvent.objects.create(
            recovery_request=reset_request,
            user=self.student_a,
            event_type=PasswordRecoveryAuditEvent.EventType.NFC_REJECTED,
            outcome=PasswordRecoveryAuditEvent.Outcome.FAILURE,
            reason_code='card_account_mismatch',
            actor_type=PasswordRecoveryAuditEvent.ActorType.PI,
        )

        ordinary_user = self.student_b
        self.client.force_login(ordinary_user)
        request_url = reverse('admin:api_passwordresetrequest_change', args=[reset_request.pk])
        self.assertNotEqual(self.client.get(request_url).status_code, 200)

        admin_user = User.objects.create_user(
            username='recovery-history-admin',
            email='recovery-history-admin@example.com',
            password='admin-password',
            role=User.RoleChoices.ADMIN,
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_login(admin_user)
        response = self.client.get(request_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, reset_request.request_id)
        self.assertContains(response, self.student_a.get_full_name())
        self.assertContains(response, self.student_a.student_id)
        self.assertContains(response, 'NFC rejected')
        self.assertContains(response, 'card_account_mismatch')
        self.assertNotContains(response, authorization)
        self.assertNotContains(response, 'private-reset-nonce')
        self.assertNotContains(response, reset_request.reset_authorization_hash)
        self.assertFalse(django_admin.site._registry[PasswordResetRequest].has_add_permission(
            RequestFactory().get('/admin/')
        ))
        self.assertFalse(django_admin.site._registry[PasswordResetRequest].has_delete_permission(
            RequestFactory().get('/admin/'), reset_request
        ))

    def test_invalid_token_is_rejected_without_authorization(self):
        reset_request, _ = self._create_verified_reset_request()

        response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': 'invalid-token',
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!',
        }, format='json')

        self.assertEqual(response.status_code, 400)

    def test_expired_request_status_does_not_issue_authorization(self):
        reset_request, _ = self._create_verified_reset_request()
        reset_request.expires_at = timezone.now() - timedelta(minutes=1)
        reset_request.save(update_fields=['expires_at'])

        response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'expired'})

    def test_token_cannot_validate_against_another_request(self):
        first_request, _ = self._create_verified_reset_request(self.student_a)
        second_request, _ = self._create_verified_reset_request(self.student_b)
        first_status = self.client.post('/api/auth/password-reset/status/', {
            'request_id': first_request.request_id,
        }, format='json').json()
        second_status = self.client.post('/api/auth/password-reset/status/', {
            'request_id': second_request.request_id,
        }, format='json').json()
        self.assertNotEqual(first_status['reset_authorization'], second_status['reset_authorization'])

    def test_used_token_is_rejected(self):
        reset_request, _ = self._create_verified_reset_request()
        reset_request.status = PasswordResetRequest.StatusChoices.USED
        reset_request.used_at = timezone.now()
        reset_request.save(update_fields=['status', 'used_at'])

        response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'used'})

    def test_expired_authorization_cannot_confirm_password(self):
        reset_request, _ = self._create_verified_reset_request()
        validation_response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')
        reset_request.refresh_from_db()
        reset_request.reset_authorization_expires_at = timezone.now() - timedelta(minutes=1)
        reset_request.save(update_fields=['reset_authorization_expires_at'])

        response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': validation_response.json()['reset_authorization'],
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!',
        }, format='json')

        self.assertEqual(response.status_code, 410)

    def test_reset_authorization_is_single_use(self):
        reset_request, _ = self._create_verified_reset_request()
        validation_response = self.client.post('/api/auth/password-reset/status/', {
            'request_id': reset_request.request_id,
        }, format='json')
        authorization = validation_response.json()['reset_authorization']

        response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': authorization,
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.json())

        replay_response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': authorization,
            'new_password': 'AnotherPassword123!',
            'confirm_password': 'AnotherPassword123!',
        }, format='json')
        self.assertEqual(replay_response.status_code, 409)

    def test_nfc_endpoint_requires_device_api_key(self):
        reset_request, _ = self._create_verified_reset_request()

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, format='json')

        self.assertEqual(response.status_code, 403)

    def test_password_reset_row_lock_excludes_nullable_user_join_on_postgresql(self):
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL row-lock SQL is only generated by the PostgreSQL backend.')

        query = PasswordResetRequest.objects.select_for_update(
            of=('self',),
        ).select_related('user')
        sql = query.query.get_compiler(connection=connection).as_sql()[0]

        self.assertRegex(sql, r'FOR UPDATE OF "[^"]+"$')

    def test_password_recovery_history_api_is_admin_only_and_masks_account_data(self):
        reset_request = PasswordResetRequest.objects.create(
            user=self.student_a,
            status=PasswordResetRequest.StatusChoices.PENDING,
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        event = PasswordRecoveryAuditEvent.objects.create(
            recovery_request=reset_request,
            user=self.student_a,
            event_type=PasswordRecoveryAuditEvent.EventType.NFC_VERIFIED,
            outcome=PasswordRecoveryAuditEvent.Outcome.SUCCESS,
            actor_type=PasswordRecoveryAuditEvent.ActorType.PI,
        )

        anonymous_response = self.client.get('/api/admin/password-recovery-history/')
        self.assertIn(anonymous_response.status_code, (401, 403))

        self.client.force_authenticate(user=self.student_a)
        student_response = self.client.get('/api/admin/password-recovery-history/')
        self.assertEqual(student_response.status_code, 403)

        administrator = User.objects.create_user(
            username='recovery-admin',
            email='recovery-admin@example.com',
            password='admin-password',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=administrator)
        response = self.client.get('/api/admin/password-recovery-history/')

        self.assertEqual(response.status_code, 200, response.json())
        result = next(item for item in response.json()['results'] if item['id'] == event.pk)
        self.assertEqual(result['student_name'], 'Student A')
        self.assertEqual(result['account_reference'], '•••-001')
        self.assertEqual(result['event_type'], PasswordRecoveryAuditEvent.EventType.NFC_VERIFIED)
        self.assertEqual(result['request_status'], PasswordResetRequest.StatusChoices.PENDING)
        self.assertNotIn('request_id', result)
        self.assertNotIn('nfc_uid', result)
        self.assertNotIn('reset_authorization', result)

    def test_password_reset_verify_requires_claimed_cabinet_handoff(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        request_id = request_response.json()['request_id']

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': request_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 409, response.json())

    def test_cabinet_handoff_requires_device_api_key_and_valid_request(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        request_id = request_response.json()['request_id']

        missing_key_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': request_id,
        }, format='json')
        self.assertEqual(missing_key_response.status_code, 403)

        invalid_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': 'not-a-real-request',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(invalid_response.status_code, 404)

    def test_cabinet_handoff_reports_unknown_expired_and_used_requests_safely(self):
        unknown_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': 'unknown-opaque-request',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(unknown_response.status_code, 404)
        self.assertEqual(unknown_response.json(), {'error': 'Reset request is unavailable.'})

        expired_creation = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        expired_request = PasswordResetRequest.objects.get(
            request_id=expired_creation.json()['request_id'],
        )
        expired_request.expires_at = timezone.now() - timedelta(minutes=1)
        expired_request.save(update_fields=['expires_at'])
        expired_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': expired_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(expired_response.status_code, 410)
        self.assertEqual(expired_response.json(), {'error': 'Reset request has expired.'})
        self.assertNotIn(self.student_a.email, expired_response.content.decode())

        used_creation = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_b.student_id,
            'email': self.student_b.email,
        }, format='json')
        used_request = PasswordResetRequest.objects.get(
            request_id=used_creation.json()['request_id'],
        )
        used_request.status = PasswordResetRequest.StatusChoices.USED
        used_request.used_at = timezone.now()
        used_request.save(update_fields=['status', 'used_at'])
        used_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': used_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(used_response.status_code, 409)
        self.assertEqual(used_response.json(), {'error': 'Reset request is no longer available.'})
        self.assertNotIn(self.student_b.email, used_response.content.decode())

    def test_cabinet_handoff_is_single_active_claim_and_expires(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])

        first_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(first_response.status_code, 200, first_response.json())

        second_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(second_response.status_code, 200, second_response.json())
        self.assertEqual(
            second_response.json()['expires_at'],
            first_response.json()['expires_at'],
        )

        reset_request.refresh_from_db()
        reset_request.cabinet_handoff_expires_at = timezone.now() - timedelta(seconds=1)
        reset_request.save(update_fields=['cabinet_handoff_expires_at'])
        retry_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(retry_response.status_code, 200, retry_response.json())

    def test_normal_login_and_existing_nfc_access_still_work(self):
        login_response = self.client.post('/api/auth/login/', {
            'username': self.student_a.username,
            'password': 'old-password-1',
            'expected_role': 'student',
        }, format='json')
        self.assertEqual(login_response.status_code, 200, login_response.json())

        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        nfc_response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(nfc_response.status_code, 200, nfc_response.json())
        reset_request = PasswordResetRequest.objects.get(request_id=request_response.json()['request_id'])
        reset_request.refresh_from_db()
        self.assertEqual(reset_request.status, PasswordResetRequest.StatusChoices.PENDING)
        self.assertFalse(reset_request.nfc_uid_verified)

    def test_password_reset_request_still_works(self):
        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_b.student_id,
            'email': self.student_b.email,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertIn('request_id', response.json())


class CabinetEventAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='cabinet-event-admin',
            email='cabinet-event-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.section = Section.objects.create(section_name='Cabinet Events A', subject_code='CAB-EVENT-A')
        self.student = User.objects.create_user(
            username='cabinet-event-student',
            email='cabinet-event-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            first_name='Avery',
            last_name='Student',
            student_id='CAB-EVENT-001',
            nfc_uid='CARD-CAB-EVENT-001',
            section=self.section,
        )
        self.other_student = User.objects.create_user(
            username='cabinet-event-other',
            email='cabinet-event-other@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='CAB-EVENT-002',
        )
        opened_at = timezone.now() - timedelta(seconds=12)
        self.session = CabinetSession.objects.create(station='Station 1', status=CabinetSession.StatusChoices.CLOSED)
        self.session.opened_at = opened_at
        self.session.closed_at = opened_at + timedelta(seconds=12)
        self.session.save(update_fields=['opened_at', 'closed_at'])
        self.event = CabinetEvent.objects.create(
            user=self.student,
            event_type='cabinet_opened',
            details={
                'event_type': 'cabinet_opened',
                'station': 'Station 1',
                'cabinet_id': 'Cabinet A',
                'nfc_uid': self.student.nfc_uid,
                'access_method': 'NFC',
                'result': 'success',
                'cabinet_session_id': self.session.pk,
            },
        )
        self.other_event = CabinetEvent.objects.create(
            user=self.other_student,
            event_type='access_denied',
            details={'event_type': 'access_denied', 'result': 'rejected', 'failure_reason': 'Inactive account'},
        )

    def test_user_filter_and_event_details_use_real_owner_relationship(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(f'/api/cabinet-events/?user={self.student.pk}')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()['results']
        self.assertEqual([entry['id'] for entry in payload], [self.event.pk])
        self.assertEqual(payload[0]['user'], self.student.pk)
        self.assertEqual(payload[0]['user_name'], 'Avery Student')
        self.assertEqual(payload[0]['user_identifier'], 'CAB-EVENT-001')
        self.assertEqual(payload[0]['role'], User.RoleChoices.STUDENT)
        self.assertEqual(payload[0]['section_name'], 'Cabinet Events A')
        self.assertEqual(payload[0]['station'], 'Station 1')
        self.assertEqual(payload[0]['cabinet_id'], 'Cabinet A')
        self.assertEqual(payload[0]['event_type'], 'Cabinet Opened')
        self.assertEqual(payload[0]['result'], 'Success')
        self.assertEqual(payload[0]['access_method'], 'NFC')
        self.assertEqual(payload[0]['nfc_uid'], self.student.nfc_uid)
        self.assertEqual(payload[0]['duration_seconds'], 12)

        detail_response = self.client.get(f'/api/cabinet-events/{self.event.pk}/')
        self.assertEqual(detail_response.status_code, 200, detail_response.json())
        self.assertEqual(detail_response.json()['id'], self.event.pk)

        denied_response = self.client.get(f'/api/cabinet-events/?user={self.other_student.pk}')
        self.assertEqual(denied_response.status_code, 200, denied_response.json())
        denied_event = denied_response.json()['results'][0]
        self.assertEqual(denied_event['user'], self.other_student.pk)
        self.assertEqual(denied_event['event_type'], 'Access Denied')
        self.assertEqual(denied_event['failure_reason'], 'Inactive account')

    def test_event_records_cannot_be_edited_but_admin_can_delete(self):
        self.client.force_authenticate(user=self.admin)
        detail_url = f'/api/cabinet-events/{self.event.pk}/'

        update_response = self.client.patch(detail_url, {'event_type': 'access_denied'}, format='json')
        self.assertEqual(update_response.status_code, 405)

        self.client.force_authenticate(user=self.student)
        denied_delete = self.client.delete(detail_url)
        self.assertEqual(denied_delete.status_code, 403)

        self.client.force_authenticate(user=self.admin)
        delete_response = self.client.delete(detail_url)
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(CabinetEvent.objects.filter(pk=self.event.pk).exists())

    def test_all_supported_cabinet_event_types_have_meaningful_results(self):
        expected = {
            'access_granted': ('Access Granted', 'Success'),
            'access_denied': ('Access Denied', 'Denied'),
            'cabinet_opened': ('Cabinet Opened', 'Success'),
            'cabinet_closed': ('Cabinet Closed', 'Success'),
            'unlock_failed': ('Unlock Failed', 'Failed'),
            'session_timeout': ('Session Timeout', 'Timeout'),
        }
        for event_type in expected:
            details = {'event_type': event_type}
            if event_type not in {'access_denied', 'unlock_failed', 'session_timeout'}:
                details['result'] = 'success'
            if event_type == 'unlock_failed':
                details['failure_reason'] = 'Cabinet unlock failed'
            CabinetEvent.objects.create(user=self.student, event_type=event_type, details=details)

        self.client.force_authenticate(user=self.admin)
        response = self.client.get(f'/api/cabinet-events/?user={self.student.pk}')
        self.assertEqual(response.status_code, 200, response.json())
        serialized = {entry['details']['event_type']: (entry['event_type'], entry['result']) for entry in response.json()['results']}
        for event_type, expected_values in expected.items():
            self.assertEqual(serialized[event_type], expected_values)


class UserProfileAccessLogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='profile-log-admin',
            email='profile-log-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.instructor = User.objects.create_user(
            username='profile-log-instructor',
            email='profile-log-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='PROFILE-LOG-INSTRUCTOR',
        )
        self.section = Section.objects.create(
            section_name='Profile Log Section',
            subject_code='PROFILE-LOG',
            instructor=self.instructor,
        )
        self.mary_section = Section.objects.create(
            section_name='Profile Log Section B',
            subject_code='PROFILE-LOG-B',
        )
        self.john = User.objects.create_user(
            username='profile-log-john',
            email='john@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='PROFILE-LOG-JOHN',
            section=self.section,
        )
        self.mary = User.objects.create_user(
            username='profile-log-mary',
            email='mary@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='PROFILE-LOG-MARY',
            section=self.mary_section,
        )
        self.john_logs = [
            AccessLog.objects.create(user=self.john, action='open', status='success', station='Station 1'),
            AccessLog.objects.create(user=self.john, action='close', status='success', station='Station 1'),
            AccessLog.objects.create(user=self.john, action='open', status='success', station='Station 2'),
        ]
        self.mary_logs = [
            AccessLog.objects.create(user=self.mary, action='open', status='success', station='Station 2'),
            AccessLog.objects.create(user=self.mary, action='close', status='success', station='Station 2'),
        ]

    def test_admin_profile_logs_are_user_specific_and_global_logs_remain_global(self):
        self.client.force_authenticate(user=self.admin)

        for user, expected_logs in ((self.john, self.john_logs), (self.mary, self.mary_logs)):
            response = self.client.get(f'/api/users/{user.pk}/access-logs/?page_size=5')
            self.assertEqual(response.status_code, 200, response.json())
            self.assertEqual(
                {entry['id'] for entry in response.json()['results']},
                {log.pk for log in expected_logs},
            )
            self.assertEqual({entry['user'] for entry in response.json()['results']}, {user.pk})

        global_response = self.client.get('/api/access-logs/')
        self.assertEqual(global_response.status_code, 200, global_response.json())
        global_users = {entry['user'] for entry in global_response.json()['results']}
        self.assertEqual(global_users, {self.john.pk, self.mary.pk})

    def test_admin_profile_details_scope_records_and_counts_to_selected_user(self):
        john_activity = Activity.objects.create(title='John activity', created_by=self.instructor, section=self.section)
        mary_activity = Activity.objects.create(title='Mary activity', created_by=self.instructor, section=self.mary_section)
        john_submission = Submission.objects.create(activity=john_activity, student=self.john)
        mary_submission = Submission.objects.create(activity=mary_activity, student=self.mary)
        self.client.force_authenticate(user=self.admin)

        for user, own_logs, own_activity, own_submission in (
            (self.john, self.john_logs, john_activity, john_submission),
            (self.mary, self.mary_logs, mary_activity, mary_submission),
        ):
            response = self.client.get(f'/api/users/{user.pk}/profile-details/')
            self.assertEqual(response.status_code, 200, response.json())
            payload = response.json()
            self.assertEqual(payload['counts'], {
                'access_logs': len(own_logs),
                'activities': 1,
                'submissions': 1,
            })
            self.assertEqual(
                {entry['id'] for entry in payload['access_logs']},
                {log.pk for log in own_logs},
            )
            self.assertEqual({entry['id'] for entry in payload['activities']}, {own_activity.pk})
            self.assertEqual({entry['id'] for entry in payload['submissions']}, {own_submission.pk})
            for endpoint, expected_id in (
                ('activities', own_activity.pk),
                ('submissions', own_submission.pk),
            ):
                list_response = self.client.get(f'/api/users/{user.pk}/{endpoint}/')
                self.assertEqual(list_response.status_code, 200, list_response.json())
                self.assertEqual(
                    {entry['id'] for entry in list_response.json()['results']},
                    {expected_id},
                )

    def test_access_log_detail_returns_exact_cabinet_event_fields(self):
        opened_at = timezone.now() - timedelta(minutes=5)
        session = CabinetSession.objects.create(
            station='Station 4',
            status=CabinetSession.StatusChoices.CLOSED,
        )
        session.opened_at = opened_at
        session.closed_at = opened_at + timedelta(minutes=5)
        session.save(update_fields=['opened_at', 'closed_at'])
        log = AccessLog.objects.create(
            user=self.john,
            cabinet_session=session,
            action=AccessLog.AccessActionChoices.OPEN,
            status=AccessLog.AccessStatusChoices.SUCCESS,
            nfc_uid='ABCD1234',
            reason='Cabinet session opened',
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(f'/api/access-logs/{log.pk}/')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertEqual(payload['id'], log.pk)
        self.assertEqual(payload['user'], self.john.pk)
        self.assertEqual(payload['username'], self.john.username)
        self.assertEqual(payload['role'], User.RoleChoices.STUDENT)
        self.assertEqual(payload['station'], 'Station 4')
        self.assertEqual(payload['access_type'], 'Cabinet Opened')
        self.assertEqual(payload['access_method'], 'NFC')
        self.assertEqual(payload['nfc_uid'], 'ABCD1234')
        self.assertEqual(payload['status'], AccessLog.AccessStatusChoices.SUCCESS)
        self.assertEqual(payload['duration_seconds'], 300)

    def test_instructor_and_student_profile_log_requests_obey_user_scope(self):
        self.client.force_authenticate(user=self.instructor)
        instructor_response = self.client.get(f'/api/users/{self.john.pk}/access-logs/')
        self.assertEqual(instructor_response.status_code, 200, instructor_response.json())
        self.assertEqual(
            {entry['user'] for entry in instructor_response.json()['results']},
            {self.john.pk},
        )
        self.assertEqual(self.client.get(f'/api/users/{self.mary.pk}/access-logs/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/access-logs/{self.mary_logs[0].pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/profile-details/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/activities/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/submissions/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/users/{self.mary.pk}/profile-details/').status_code, 404)

        self.client.force_authenticate(user=self.john)
        self_response = self.client.get(f'/api/users/{self.john.pk}/access-logs/')
        other_response = self.client.get(f'/api/users/{self.mary.pk}/access-logs/')
        self.assertEqual(self_response.status_code, 200, self_response.json())
        self.assertEqual({entry['user'] for entry in self_response.json()['results']}, {self.john.pk})
        self.assertEqual(other_response.status_code, 404)
        self.assertEqual(self.client.get(f'/api/access-logs/{self.john_logs[0].pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/access-logs/{self.mary_logs[0].pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/profile-details/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/activities/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/users/{self.john.pk}/submissions/').status_code, 403)


@override_settings(TAPTRACK_NFC_DEVICE_MAP=[
    {'device_id': 'PHOTO-CABINET', 'api_key': 'photo-test-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True},
])
class AccessLogPhotoApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.device_api_key = 'photo-test-key'
        os.environ['DEVICE_API_KEY'] = self.device_api_key
        self.media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=self.media_directory.name))
        self.student = User.objects.create_user(
            username='photo-student',
            email='photo-student@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='PHOTO-001',
        )
        self.access_log = AccessLog.objects.create(
            user=self.student,
            nfc_uid='PHOTO-UID-001',
            station='Station 1',
            cabinet_name='Cabinet 1',
            status=AccessLog.AccessStatusChoices.SUCCESS,
        )

    def jpeg_upload(self, filename='camera-supplied-name.jpg'):
        image_data = BytesIO()
        Image.new('RGB', (8, 8), color=(30, 80, 120)).save(image_data, format='JPEG')
        return SimpleUploadedFile(filename, image_data.getvalue(), content_type='image/jpeg')

    def upload_url(self, event_id=None):
        return f'/api/access-logs/{event_id or self.access_log.pk}/photo/'

    def test_authorized_device_uploads_jpeg_to_existing_event(self):
        response = self.client.post(
            self.upload_url(),
            {'image': self.jpeg_upload(), 'station': 'Forged station', 'student_id': 'FORGED'},
            HTTP_X_API_KEY=self.device_api_key,
            format='multipart',
        )

        self.assertEqual(response.status_code, 201, response.json())
        photo = AccessLogPhoto.objects.get(access_log=self.access_log)
        self.assertEqual(photo.capture_status, AccessLogPhoto.CaptureStatusChoices.SUCCESS)
        self.assertIsNotNone(photo.captured_at)
        self.assertTrue(photo.image.name.startswith('access-log-photos/'))
        self.assertTrue(photo.image.name.endswith('.jpg'))
        self.assertNotIn('camera-supplied-name', photo.image.name)
        self.assertEqual(response.json()['event_id'], self.access_log.pk)
        self.assertNotIn('url', response.json())
        self.assertEqual(photo.access_log.station, 'Station 1')
        self.assertEqual(photo.access_log.user, self.student)

    def test_photo_metadata_reports_unavailable_for_access_log_without_photo(self):
        response = self.client.get(
            self.upload_url(), HTTP_X_API_KEY=self.device_api_key,
        )

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json(), {
            'event_id': self.access_log.pk,
            'capture_status': None,
            'captured_at': None,
            'diagnostic_error': None,
            'image_available': False,
            'image_endpoint': None,
        })
        missing_image = self.client.get(
            f'/api/access-logs/{self.access_log.pk}/photo/image/',
            HTTP_X_API_KEY=self.device_api_key,
        )
        self.assertEqual(missing_image.status_code, 404)

    def test_pending_and_failed_capture_statuses_are_read_back_from_backend(self):
        pending = self.client.post(
            f'/api/access-logs/{self.access_log.pk}/photo-status/',
            {'status': 'pending'}, HTTP_X_API_KEY=self.device_api_key, format='json',
        )
        pending_metadata = self.client.get(self.upload_url(), HTTP_X_API_KEY=self.device_api_key)
        self.assertEqual(pending.status_code, 200, pending.json())
        self.assertEqual(pending_metadata.json()['capture_status'], 'pending')
        self.assertIsNone(pending_metadata.json()['captured_at'])
        self.assertFalse(pending_metadata.json()['image_available'])

        failed = self.client.post(
            f'/api/access-logs/{self.access_log.pk}/photo-status/',
            {'status': 'failed', 'error': 'Camera unavailable'},
            HTTP_X_API_KEY=self.device_api_key, format='json',
        )
        failed_metadata = self.client.get(self.upload_url(), HTTP_X_API_KEY=self.device_api_key)
        self.assertEqual(failed.status_code, 200, failed.json())
        self.assertEqual(failed_metadata.json()['capture_status'], 'failed')
        self.assertEqual(failed_metadata.json()['diagnostic_error'], 'Camera unavailable')
        self.assertIsNotNone(failed_metadata.json()['captured_at'])

    def test_same_cabinet_device_can_read_a_station_two_event(self):
        station_two_event = AccessLog.objects.create(
            user=self.student,
            nfc_uid='PHOTO-STATION-TWO',
            station='Station 2',
            cabinet_name='Cabinet 1',
            status=AccessLog.AccessStatusChoices.SUCCESS,
        )
        uploaded = self.client.post(
            self.upload_url(station_two_event.pk), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        metadata = self.client.get(
            self.upload_url(station_two_event.pk), HTTP_X_API_KEY=self.device_api_key,
        )

        self.assertEqual(uploaded.status_code, 201, uploaded.json())
        self.assertEqual(metadata.status_code, 200, metadata.json())
        self.assertEqual(metadata.json()['event_id'], station_two_event.pk)
        self.assertEqual(metadata.json()['capture_status'], 'success')
        image = self.client.get(metadata.json()['image_endpoint'], HTTP_X_API_KEY=self.device_api_key)
        self.assertEqual(image.status_code, 200)
        image.close()

    def test_missing_and_invalid_device_credentials_cannot_read_photo_data(self):
        for path in (self.upload_url(), f'/api/access-logs/{self.access_log.pk}/photo/image/'):
            with self.subTest(path=path):
                missing = self.client.get(path)
                invalid = self.client.get(path, HTTP_X_API_KEY='invalid-photo-key')
                self.assertEqual(missing.status_code, 401)
                self.assertEqual(invalid.status_code, 401)

    def test_photo_metadata_and_image_bytes_require_authorized_device(self):
        uploaded = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.json())

        metadata = self.client.get(self.upload_url(), HTTP_X_API_KEY=self.device_api_key)
        self.assertEqual(metadata.status_code, 200, metadata.json())
        self.assertEqual(metadata.json()['capture_status'], AccessLogPhoto.CaptureStatusChoices.SUCCESS)
        self.assertTrue(metadata.json()['image_available'])
        self.assertEqual(
            metadata.json()['image_endpoint'],
            f'/api/access-logs/{self.access_log.pk}/photo/image/',
        )
        self.assertNotIn('/media/', metadata.json()['image_endpoint'])

        image = self.client.get(
            metadata.json()['image_endpoint'],
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_ACCEPT='image/jpeg',
        )
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image['Content-Type'], 'image/jpeg')
        self.assertIn('private', image['Cache-Control'])
        self.assertIn('no-store', image['Cache-Control'])
        image_bytes = b''.join(image.streaming_content)
        self.assertTrue(image_bytes.startswith(b'\xff\xd8'))
        image.close()

        missing_key = self.client.get(self.upload_url())
        self.assertEqual(missing_key.status_code, 401)

    def test_device_photo_reads_are_limited_to_its_cabinet(self):
        other_cabinet_event = AccessLog.objects.create(
            nfc_uid='PHOTO-OTHER-CABINET', station='Station 2', cabinet_name='Cabinet 2',
        )

        response = self.client.get(
            self.upload_url(other_cabinet_event.pk), HTTP_X_API_KEY=self.device_api_key,
        )

        self.assertEqual(response.status_code, 404)

    def test_jwt_photo_reads_follow_student_and_instructor_log_permissions(self):
        uploaded = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.json())
        image_path = f'/api/access-logs/{self.access_log.pk}/photo/image/'
        other_student = User.objects.create_user(
            username='photo-other-student', email='photo-other@example.com',
            password='secret1234', role=User.RoleChoices.STUDENT, student_id='PHOTO-002',
        )
        another_cabinet_log = AccessLog.objects.create(
            user=other_student,
            nfc_uid='PHOTO-ADMIN-OTHER-CABINET',
            station='Station 2',
            cabinet_name='Cabinet 2',
            status=AccessLog.AccessStatusChoices.SUCCESS,
        )
        another_cabinet_photo_path = f'/api/access-logs/{another_cabinet_log.pk}/photo/'
        self.client.force_authenticate(user=other_student)
        self.assertEqual(self.client.get(another_cabinet_photo_path).status_code, 200)
        self.assertEqual(self.client.get(f'{another_cabinet_photo_path}image/').status_code, 404)

        self.client.force_authenticate(user=self.student)
        self.assertEqual(self.client.get(self.upload_url()).status_code, 200)
        student_logs = self.client.get('/api/access-logs/').json()['results']
        self.assertEqual({entry['user'] for entry in student_logs}, {self.student.pk})
        self.assertEqual(student_logs[0]['photo_capture_status'], 'success')
        self.assertNotIn('image_endpoint', student_logs[0])
        self.assertEqual(self.client.get(another_cabinet_photo_path).status_code, 404)
        self.assertEqual(self.client.get(f'{another_cabinet_photo_path}image/').status_code, 404)
        student_metadata = self.client.get(self.upload_url()).json()
        self.assertEqual(student_metadata['capture_status'], 'success')
        self.assertIsNone(student_metadata['captured_at'])
        self.assertIsNone(student_metadata['diagnostic_error'])
        self.assertTrue(student_metadata['image_available'])
        self.assertEqual(
            student_metadata['image_endpoint'],
            f'/api/access-logs/{self.access_log.pk}/photo/image/',
        )
        student_image = self.client.get(image_path, HTTP_ACCEPT='image/jpeg')
        self.assertEqual(student_image.status_code, 200)
        self.assertEqual(student_image['Content-Type'], 'image/jpeg')
        self.assertIn('private', student_image['Cache-Control'])
        self.assertIn('no-store', student_image['Cache-Control'])
        self.assertTrue(b''.join(student_image.streaming_content).startswith(b'\xff\xd8'))
        student_image.close()

        instructor = User.objects.create_user(
            username='photo-instructor', email='photo-instructor@example.com',
            password='secret1234', role=User.RoleChoices.INSTRUCTOR, instructor_id='PHOTO-INS-1',
        )
        section = Section.objects.create(
            section_name='Photo Access Section', subject_code='PHOTO-101', instructor=instructor,
        )
        self.student.section = section
        self.student.save(update_fields=['section'])
        self.client.force_authenticate(user=instructor)

        self.assertEqual(self.client.get(self.upload_url()).status_code, 200)
        instructor_image = self.client.get(image_path)
        self.assertEqual(instructor_image.status_code, 200)
        instructor_image.close()

        assigned_section = Section.objects.create(
            section_name='M2M Assigned Photo Section', subject_code='PHOTO-ASSIGNED',
        )
        assigned_section.assigned_instructors.add(instructor)
        assigned_student = User.objects.create_user(
            username='photo-m2m-assigned-student', email='photo-m2m-assigned@example.com',
            password='secret1234', role=User.RoleChoices.STUDENT, student_id='PHOTO-ASSIGNED-1',
            section=assigned_section,
        )
        assigned_log = AccessLog.objects.create(
            user=assigned_student, nfc_uid='PHOTO-M2M-ASSIGNED', station='Station 2',
            cabinet_name='Cabinet 1', status=AccessLog.AccessStatusChoices.SUCCESS,
        )
        self.client.force_authenticate(user=instructor)
        self.assertEqual(self.client.get(f'/api/access-logs/{assigned_log.pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/access-logs/{assigned_log.pk}/photo/').status_code, 200)

        assigned_upload = self.client.post(
            self.upload_url(assigned_log.pk), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        self.assertEqual(assigned_upload.status_code, 201, assigned_upload.json())
        assigned_image = self.client.get(f'/api/access-logs/{assigned_log.pk}/photo/image/')
        self.assertEqual(assigned_image.status_code, 200)
        assigned_image.close()

        unrelated_instructor = User.objects.create_user(
            username='unrelated-photo-instructor', email='unrelated-photo@example.com',
            password='secret1234', role=User.RoleChoices.INSTRUCTOR, instructor_id='PHOTO-INS-2',
        )
        Section.objects.create(
            section_name='Unrelated Photo Section', subject_code='PHOTO-202', instructor=unrelated_instructor,
        )
        self.client.force_authenticate(user=unrelated_instructor)
        self.assertEqual(self.client.get(self.upload_url()).status_code, 404)
        self.assertEqual(self.client.get(image_path, HTTP_ACCEPT='image/jpeg').status_code, 404)

        admin_user = User.objects.create_superuser(
            username='photo-read-admin', email='photo-read-admin@example.com', password='secret1234',
        )
        self.client.force_authenticate(user=admin_user)
        self.assertEqual(self.client.get(self.upload_url()).status_code, 200)
        self.assertEqual(self.client.get(another_cabinet_photo_path).status_code, 200)
        admin_image = self.client.get(image_path)
        self.assertEqual(admin_image.status_code, 200)
        admin_image.close()

    def test_upload_requires_valid_device_api_key(self):
        missing = self.client.post(self.upload_url(), {'image': self.jpeg_upload()}, format='multipart')
        invalid = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY='incorrect-key', format='multipart',
        )

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(invalid.status_code, 403)
        self.assertFalse(AccessLogPhoto.objects.exists())

    def test_upload_rejects_invalid_image_and_oversized_file(self):
        invalid = SimpleUploadedFile('not-an-image.jpg', b'not a jpeg', content_type='image/jpeg')
        invalid_response = self.client.post(
            self.upload_url(), {'image': invalid}, HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        oversized = SimpleUploadedFile(
            'large.jpg', b'x' * (5 * 1024 * 1024 + 1), content_type='image/jpeg',
        )
        oversized_response = self.client.post(
            self.upload_url(), {'image': oversized}, HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )

        self.assertEqual(invalid_response.status_code, 400)
        self.assertEqual(oversized_response.status_code, 413)
        self.assertFalse(AccessLogPhoto.objects.exists())

    def test_device_cannot_upload_to_another_cabinets_event(self):
        other_cabinet_event = AccessLog.objects.create(
            nfc_uid='OTHER-CABINET-UID', station='Station 2', cabinet_name='Cabinet 2',
        )
        response = self.client.post(
            self.upload_url(other_cabinet_event.pk), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(AccessLogPhoto.objects.exists())

    def test_duplicate_photo_upload_is_rejected(self):
        first = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        duplicate = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )

        self.assertEqual(first.status_code, 201, first.json())
        self.assertEqual(duplicate.status_code, 409, duplicate.json())
        self.assertEqual(AccessLogPhoto.objects.filter(access_log=self.access_log).count(), 1)

    def test_camera_failure_status_is_recorded_without_changing_access_event(self):
        response = self.client.post(
            f'/api/access-logs/{self.access_log.pk}/photo-status/',
            {'status': 'failed', 'error': 'Camera did not respond'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.json())
        photo = AccessLogPhoto.objects.get(access_log=self.access_log)
        self.assertEqual(photo.capture_status, AccessLogPhoto.CaptureStatusChoices.FAILED)
        self.assertEqual(photo.diagnostic_error, 'Camera did not respond')
        self.assertIsNotNone(photo.captured_at)
        self.access_log.refresh_from_db()
        self.assertEqual(self.access_log.status, AccessLog.AccessStatusChoices.SUCCESS)

    def test_admin_displays_photo_and_private_file_is_staff_only(self):
        uploaded = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.json())
        admin_user = User.objects.create_superuser(
            username='photo-admin', email='photo-admin@example.com', password='secret1234',
        )
        self.client.force_login(admin_user)

        listing = self.client.get(reverse('admin:api_accesslog_changelist'))
        self.assertEqual(listing.status_code, 200)
        self.assertContains(listing, '<img', html=False)
        photo = AccessLogPhoto.objects.get(access_log=self.access_log)
        protected = self.client.get(reverse('admin:api_accesslog_photo', args=[self.access_log.pk]))
        public_media = self.client.get(f'/media/{photo.image.name}')
        self.assertEqual(protected.status_code, 200)
        self.assertEqual(protected['Content-Type'], 'image/jpeg')
        self.assertIn('no-store', protected['Cache-Control'])
        self.assertEqual(public_media.status_code, 404)
        protected.close()
        self.client.logout()
        unauthenticated = self.client.get(reverse('admin:api_accesslog_photo', args=[self.access_log.pk]))
        self.assertEqual(unauthenticated.status_code, 302)

    def test_legacy_access_log_without_photo_remains_valid(self):
        access_log_admin = AccessLogAdmin(model=AccessLog, admin_site=django_admin.site)

        self.assertFalse(AccessLogPhoto.objects.filter(access_log=self.access_log).exists())
        self.assertEqual(access_log_admin.photo_thumbnail(self.access_log), 'No photo')
        self.assertEqual(access_log_admin.photo_capture_status(self.access_log), 'Not captured')
        self.assertEqual(self.access_log.status, AccessLog.AccessStatusChoices.SUCCESS)

    def test_deleting_photo_metadata_removes_stored_image(self):
        response = self.client.post(
            self.upload_url(), {'image': self.jpeg_upload()},
            HTTP_X_API_KEY=self.device_api_key, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.json())
        photo = AccessLogPhoto.objects.get(access_log=self.access_log)
        stored_name = photo.image.name
        self.assertTrue(photo.image.storage.exists(stored_name))

        photo.delete()

        self.assertFalse(photo.image.storage.exists(stored_name))


class AccessLogPhotoMigrationTests(TransactionTestCase):
    migrate_from = ('api', '0035_cabinetsession_unique_open_station')
    migrate_to = ('api', '0036_accesslogphoto')

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        historical_log = old_apps.get_model('api', 'AccessLog').objects.create(
            nfc_uid='MIGRATION-LEGACY-UID',
            station='Station 1',
            cabinet_name='Cabinet 1',
            status='success',
        )
        self.access_log_id = historical_log.pk
        MigrationExecutor(connection).migrate([self.migrate_to])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_access_log_survives_photo_migration_without_photo(self):
        new_apps = MigrationExecutor(connection).loader.project_state([self.migrate_to]).apps
        historical_log = new_apps.get_model('api', 'AccessLog').objects.get(pk=self.access_log_id)
        photo_model = new_apps.get_model('api', 'AccessLogPhoto')

        self.assertEqual(historical_log.nfc_uid, 'MIGRATION-LEGACY-UID')
        self.assertEqual(historical_log.station, 'Station 1')
        self.assertEqual(historical_log.status, 'success')
        self.assertFalse(photo_model.objects.filter(access_log_id=self.access_log_id).exists())


@override_settings(TAPTRACK_NFC_DEVICE_MAP=[
    {'device_id': 'CABINET1-STATION1', 'api_key': 'cabinet-device-test-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True},
])
class CabinetDeviceIntegrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.device_api_key = 'cabinet-device-test-key'
        os.environ['DEVICE_API_KEY'] = self.device_api_key
        self.section = Section.objects.create(section_name='Cabinet Section', subject_code='CAB-101')

    @override_settings(TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'])
    def test_station_status_is_derived_per_station_and_hides_details_from_students(self):
        student = User.objects.create_user(
            username='station-status-student',
            email='station-status@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='STATION-STATUS-001',
        )
        session = CabinetSession.objects.create(
            station='Station 1',
            status=CabinetSession.StatusChoices.OPEN,
        )
        session.opened_by.add(student)
        self.client.force_authenticate(user=student)

        response = self.client.get('/api/cabinet-sessions/station-status/')

        self.assertEqual(response.status_code, 200, response.json())
        stations = response.json()['stations']
        self.assertEqual(
            [(item['station'], item['status']) for item in stations],
            [('Station 1', 'OCCUPIED'), ('Station 2', 'AVAILABLE')],
        )
        self.assertIsNone(stations[0]['active_session'])
        station_two_session = CabinetSession.objects.create(
            station='Station 2',
            status=CabinetSession.StatusChoices.OPEN,
        )

        instructor = User.objects.create_user(
            username='station-status-instructor',
            email='station-status-instructor@example.com',
            password='secret1234',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='STATION-STATUS-INSTRUCTOR',
        )
        self.client.force_authenticate(user=instructor)
        instructor_response = self.client.get('/api/cabinet-sessions/station-status/')
        instructor_station = instructor_response.json()['stations'][0]
        self.assertEqual(instructor_station['status'], 'OCCUPIED')
        self.assertEqual(instructor_station['active_session']['participant_count'], 1)
        self.assertTrue(instructor_station['active_session']['opened_at'])
        self.assertEqual(instructor_response.json()['stations'][1]['status'], 'OCCUPIED')

        admin = User.objects.create_user(
            username='station-status-admin',
            email='station-status-admin@example.com',
            password='secret1234',
            role=User.RoleChoices.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        admin_response = self.client.get('/api/cabinet-sessions/station-status/')
        admin_station = admin_response.json()['stations'][0]
        self.assertEqual(admin_station['active_session']['id'], session.pk)
        self.assertEqual(admin_station['active_session']['station'], 'Station 1')

        session.status = CabinetSession.StatusChoices.CLOSED
        session.save(update_fields=['status', 'updated_at'])
        closed_response = self.client.get('/api/cabinet-sessions/station-status/')
        self.assertEqual(closed_response.json()['stations'][0]['status'], 'AVAILABLE')
        self.assertEqual(closed_response.json()['stations'][1]['status'], 'OCCUPIED')

        station_two_session.status = CabinetSession.StatusChoices.CLOSED
        station_two_session.save(update_fields=['status', 'updated_at'])
        all_available_response = self.client.get('/api/cabinet-sessions/station-status/')
        self.assertEqual(
            [item['status'] for item in all_available_response.json()['stations']],
            ['AVAILABLE', 'AVAILABLE'],
        )

    @override_settings(DEBUG=True, TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'])
    def test_mock_workflow_requires_a_matching_device_api_key(self):
        missing_key = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        )
        incorrect_key = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY='incorrect-device-key',
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        )

        self.assertEqual(missing_key.status_code, 403)
        self.assertEqual(incorrect_key.status_code, 403)
        self.assertFalse(CabinetSession.objects.exists())

    @override_settings(
        DEBUG=True,
        TAPTRACK_CABINET_NAME='Cabinet 1',
        TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    )
    def test_valid_mock_workflow_get_is_read_only(self):
        response = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        )

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['mode'], 'mock')
        self.assertEqual(CabinetSession.objects.count(), 0)
        self.assertEqual(AccessLog.objects.count(), 0)

    @override_settings(DEBUG=False)
    def test_mock_workflow_is_denied_when_debug_is_disabled(self):
        response = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(CabinetSession.objects.exists())

    @override_settings(DEBUG=False, TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'])
    def test_hardware_workflow_get_authenticates_configured_reader(self):
        response = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
        )

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['mode'], 'hardware')
        self.assertEqual(response.json()['cabinet_name'], 'Cabinet 1')
        self.assertFalse(response.json()['stations'][0]['session'])

    @override_settings(
        DEBUG=True,
        TAPTRACK_NFC_DEVICE_MAP=[{
            'device_id': 'CABINET1-STATION1',
            'api_key': 'cabinet-device-test-key',
            'station': 'Station 1',
            'cabinet_name': 'Cabinet 1',
            'active': True,
        }],
        TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    )
    def test_open_workflow_rejects_same_station_but_allows_another_station(self):
        first = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        second_station = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 2'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        duplicate = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )

        self.assertEqual(first.status_code, 200, first.json())
        self.assertEqual(second_station.status_code, 200, second_station.json())
        self.assertEqual(duplicate.status_code, 409, duplicate.json())

    @override_settings(
        DEBUG=True,
        TAPTRACK_NFC_DEVICE_MAP=[{
            'device_id': 'CABINET1-STATION1',
            'api_key': 'cabinet-device-test-key',
            'station': 'Station 1',
            'cabinet_name': 'Cabinet 1',
            'active': True,
        }],
        TAPTRACK_CABINET_NAME='Cabinet 1',
        TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    )
    def test_mock_workflow_lists_configured_station_state_and_accepts_only_configured_choice(self):
        CabinetSession.objects.create(station='Station 2', status=CabinetSession.StatusChoices.OPEN)

        response = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        )

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertEqual(payload['mode'], 'mock')
        self.assertEqual([station['name'] for station in payload['stations']], ['Station 1', 'Station 2'])
        self.assertEqual([station['status'] for station in payload['stations']], ['available', 'occupied'])
        self.assertNotIn(self.device_api_key, response.content.decode())

        opened = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(opened.status_code, 200, opened.json())
        self.assertEqual(opened.json()['station'], 'Station 1')

        student = User.objects.create_user(
            username='mock-station-student',
            email='mock-station@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='MOCK-STATION-001',
            nfc_uid='MOCK-STATION-UID',
        )
        scan = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': ' mock-station-uid ', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(scan.status_code, 200, scan.json())
        access_log = student.access_logs.get()
        self.assertEqual(access_log.cabinet_session_id, opened.json()['session']['id'])
        self.assertEqual(access_log.action, AccessLog.AccessActionChoices.OPEN)
        self.assertEqual(access_log.nfc_uid, 'MOCK-STATION-UID')
        self.assertEqual(access_log.station, 'Station 1')
        self.assertEqual(access_log.cabinet_name, 'Cabinet 1')
        self.assertEqual(access_log.reason, 'NFC verified successfully')
        self.assertEqual(scan.json()['event_id'], access_log.id)
        self.assertEqual(scan.json()['user']['student_id'], student.student_id)
        self.assertEqual(scan.json()['station']['name'], 'Station 1')

        second_student = User.objects.create_user(
            username='mock-station-student-two',
            email='mock-station-two@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='MOCK-STATION-002',
            nfc_uid='MOCK-STATION-UID-2',
        )
        second_scan = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': second_student.nfc_uid, 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(second_scan.status_code, 200, second_scan.json())

        opened_sessions = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        ).json()['stations']
        opened_session = next(item['session'] for item in opened_sessions if item['name'] == 'Station 1')
        self.assertEqual({item['studentId'] for item in opened_session['opened_by']}, {student.student_id, second_student.student_id})
        self.assertEqual(opened_session['participant_count'], 2)
        self.assertNotIn('participants', opened_session)
        self.assertNotIn('closing_participants', opened_session)

        finish_open = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'finish_open', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(finish_open.status_code, 200, finish_open.json())
        start_close = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'start_close', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(start_close.status_code, 200, start_close.json())
        for closing_student in (student, second_student):
            closing_scan = self.client.post(
                '/api/verify-nfc/',
                {'nfc_uid': closing_student.nfc_uid, 'station': 'Station 1'},
                HTTP_X_API_KEY=self.device_api_key,
                HTTP_X_TAPTRACK_MOCK_MODE='true',
                format='json',
            )
            self.assertEqual(closing_scan.status_code, 200, closing_scan.json())

        closed_sessions = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
        ).json()['stations']
        closed_by_session = next(item['session'] for item in closed_sessions if item['name'] == 'Station 1')
        self.assertEqual({item['studentId'] for item in closed_by_session['closed_by']}, {student.student_id, second_student.student_id})
        self.assertEqual(closed_by_session['participant_count'], 2)

        invalid = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 3'},
            HTTP_X_API_KEY=self.device_api_key,
            HTTP_X_TAPTRACK_MOCK_MODE='true',
            format='json',
        )
        self.assertEqual(invalid.status_code, 400)

    @override_settings(TAPTRACK_CABINET_STATIONS=[])
    def test_hardware_workflow_requires_a_configured_selected_station(self):
        student = User.objects.create_user(
            username='hardware-no-mock-station-student',
            email='hardware-no-mock-station@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='HARDWARE-NO-MOCK-001',
            nfc_uid='HARDWARE-READER-UID-001',
        )

        opened = self.client.post(
            '/api/cabinet/workflow/',
            {'command': 'open', 'station': 'Station 1'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(opened.status_code, 400, opened.json())
        self.assertEqual(opened.json()['error'], 'Select a configured cabinet station.')
        self.assertFalse(student.access_logs.exists())

    @override_settings(DEBUG=True)
    def test_unmapped_hardware_key_is_not_silently_routed_to_mock_station_validation(self):
        os.environ['DEVICE_API_KEY'] = 'unmapped-hardware-key'

        workflow = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY='unmapped-hardware-key',
        )
        scan = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': 'REAL-READER-UID'},
            HTTP_X_API_KEY='unmapped-hardware-key',
            format='json',
        )

        self.assertEqual(workflow.status_code, 403, workflow.json())
        self.assertEqual(scan.status_code, 403, scan.json())
        self.assertNotIn('mock station', workflow.json().get('error', '').lower())
        self.assertNotIn('mock station', scan.json().get('error', '').lower())
        self.assertFalse(AccessLog.objects.filter(nfc_uid='REAL-READER-UID').exists())

    def test_hardware_scan_uses_active_workflow_station_and_disabled_devices_are_rejected(self):
        student = User.objects.create_user(
            username='reader-bound-student',
            email='reader-bound@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='READER-BOUND-001',
            nfc_uid='READER-BOUND-UID',
        )

        station_one = CabinetSession.objects.create(
            station='Station 1',
            status=CabinetSession.StatusChoices.OPEN,
        )
        session = CabinetSession.objects.create(
            station='Station 2',
            status=CabinetSession.StatusChoices.OPEN,
            workflow_state=CabinetSession.WorkflowStateChoices.OPENING,
        )
        response = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': student.nfc_uid, 'station': 'Station 2'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.json())
        log = AccessLog.objects.get(user=student)
        self.assertEqual(log.station, 'Station 2')
        self.assertEqual(log.cabinet_session, session)
        self.assertEqual(log.cabinet_name, 'Cabinet 1')
        self.assertEqual(station_one.status, CabinetSession.StatusChoices.OPEN)

        with override_settings(TAPTRACK_NFC_DEVICE_MAP=[{
            'device_id': 'CABINET1-STATION1',
            'api_key': self.device_api_key,
            'station': 'Station 1',
            'cabinet_name': 'Cabinet 1',
            'active': False,
        }]):
            disabled = self.client.post(
                '/api/verify-nfc/',
                {'nfc_uid': student.nfc_uid},
                HTTP_X_API_KEY=self.device_api_key,
                format='json',
            )
        self.assertEqual(disabled.status_code, 403)

    def test_development_fixture_supports_repeatable_nfc_enrollment(self):
        from django.core.management import call_command

        call_command('loaddata', 'taptrack_test_data', verbosity=0)
        call_command('loaddata', 'taptrack_test_data', verbosity=0)

        student = User.objects.get(username='taptrack_test_student')
        self.assertEqual(student.student_id, 'TAPTRACK-TEST-001')
        self.assertEqual(student.role, User.RoleChoices.STUDENT)
        self.assertIsNone(student.nfc_uid)
        self.assertFalse(student.has_usable_password())
        self.assertEqual(student.section.subject_code, 'TAP-TEST-2026')
        self.assertEqual(User.objects.filter(username='taptrack_test_student').count(), 1)
        self.assertEqual(Section.objects.filter(subject_code='TAP-TEST-2026').count(), 1)

        test_uid = '1268010402'
        initial_verification = self.client.post('/api/verify-nfc/', {
            'nfc_uid': test_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(initial_verification.status_code, 404, initial_verification.json())
        self.assertTrue(initial_verification.json()['registration_required'])
        token = parse_qs(urlparse(initial_verification.json()['registration_url']).query)['token'][0]

        registration = register_nfc_with_email_code(self.client, {
            'token': token,
            'role': 'student',
            'username': 'taptrack_test_student',
            'student_id': student.student_id,
            'password': 'Fixture-Only-Password-123',
            'confirm_password': 'Fixture-Only-Password-123',
        })
        self.assertEqual(registration.status_code, 201, registration.json())

        verification = self.client.post('/api/verify-nfc/', {
            'nfc_uid': test_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(verification.status_code, 200, verification.json())
        self.assertEqual(verification.json()['name'], 'Jordan Santos')
        self.assertEqual(verification.json()['student_id'], 'TAPTRACK-TEST-001')
        self.assertEqual(verification.json()['role'], 'student')

    def test_cabinet_registration_persists_student_and_card_in_django(self):
        response = self.client.post('/api/cabinet/register/', {
            'full_name': 'Cabinet Student',
            'student_id': 'CAB-001',
            'email': 'cabinet.student@example.com',
            'section': 'CAB-101',
            'nfc_uid': 'card-cabinet-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        user = User.objects.get(student_id='CAB-001')
        self.assertEqual(user.nfc_uid, 'CARD-CABINET-001')
        self.assertEqual(user.section, self.section)
        self.assertFalse(user.has_usable_password())

    def test_cabinet_registration_requires_device_api_key(self):
        response = self.client.post('/api/cabinet/register/', {
            'full_name': 'Cabinet Student',
            'student_id': 'CAB-002',
            'email': 'cabinet.student2@example.com',
            'nfc_uid': 'CARD-CABINET-002',
        }, format='json')

        self.assertEqual(response.status_code, 403)

    @override_settings(TAPTRACK_CABINET_NAME='Cabinet 1')
    def test_valid_cabinet_nfc_scan_creates_successful_access_log(self):
        student = User.objects.create_user(
            username='cabinet-access-student',
            email='cabinet-access@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='CAB-ACCESS-001',
            nfc_uid='CARD-CABINET-ACCESS-001',
        )
        session = CabinetSession.objects.create(station='Station 1', status=CabinetSession.StatusChoices.OPEN)
        session.opened_by.add(student)

        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': ' card- cabinet - access-001 ',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        log = student.access_logs.get()
        self.assertEqual(log.user, student)
        self.assertEqual(log.cabinet_session, session)
        self.assertIsNotNone(log.access_time)
        self.assertEqual(log.status, AccessLog.AccessStatusChoices.SUCCESS)
        self.assertEqual(log.action, AccessLog.AccessActionChoices.SCAN)
        self.assertEqual(log.nfc_uid, 'CARD-CABINET-ACCESS-001')
        self.assertEqual(log.station, 'Station 1')
        self.assertEqual(log.cabinet_name, 'Cabinet 1')
        self.assertEqual(log.reason, 'NFC verified successfully')
        self.assertIsNotNone(log.updated_at)
        self.assertEqual(response.json()['event_id'], log.id)
        self.assertEqual(response.json()['nfc_uid'], log.nfc_uid)
        self.assertEqual(response.json()['action'], log.action)
        self.assertEqual(response.json()['cabinet_session_id'], session.pk)
        self.assertEqual(response.json()['reason'], log.reason)

    @override_settings(
        TAPTRACK_NFC_DEVICE_MAP=[{'device_id': 'CABINET1', 'api_key': 'cabinet-device-test-key', 'station': 'Station 1', 'cabinet_name': 'Cabinet 1', 'active': True}],
        TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    )
    def test_single_reader_logs_the_selected_station_when_both_are_occupied(self):
        station_response = self.client.get(
            '/api/cabinet/workflow/',
            HTTP_X_API_KEY=self.device_api_key,
        )
        self.assertEqual(station_response.status_code, 200, station_response.json())
        self.assertEqual(station_response.json()['mode'], 'hardware')
        self.assertEqual(
            [(item['name'], item['status']) for item in station_response.json()['stations']],
            [('Station 1', 'available'), ('Station 2', 'available')],
        )

        student = User.objects.create_user(
            username='multi-station-student',
            email='multi-station@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='MULTI-STATION-001',
            nfc_uid='MULTI-STATION-UID',
        )
        station_one = CabinetSession.objects.create(station='Station 1', status=CabinetSession.StatusChoices.OPEN)
        station_two = CabinetSession.objects.create(
            station='Station 2',
            status=CabinetSession.StatusChoices.OPEN,
            workflow_state=CabinetSession.WorkflowStateChoices.OPENING,
        )
        station_one.opened_by.add(student)

        response = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': student.nfc_uid},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.json())

        logs = list(student.access_logs.order_by('station'))
        self.assertEqual([log.station for log in logs], ['Station 2'])
        self.assertEqual([log.cabinet_name for log in logs], ['Cabinet 1'])
        self.assertEqual([log.cabinet_session_id for log in logs], [station_two.pk])
        self.assertEqual(station_one.status, CabinetSession.StatusChoices.OPEN)

    @override_settings(
        TAPTRACK_NFC_DEVICE_MAP=[{'device_id': 'CABINET1', 'api_key': 'reader-workflow-secret', 'cabinet_name': 'Cabinet 1', 'active': True}],
        TAPTRACK_CABINET_STATIONS=['Station 1', 'Station 2'],
    )
    def test_backend_workflow_derives_open_close_and_rejected_audit_events(self):
        participant = User.objects.create_user(
            username='workflow-participant',
            email='workflow-participant@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='WORKFLOW-001',
            nfc_uid='WORKFLOW-UID-001',
        )
        outsider = User.objects.create_user(
            username='workflow-outsider',
            email='workflow-outsider@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='WORKFLOW-002',
            nfc_uid='WORKFLOW-UID-002',
        )

        opened = self.client.post(
            '/api/cabinet/workflow/', {'command': 'open', 'station': 'Station 1'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(opened.status_code, 200, opened.json())
        session_id = opened.json()['session']['id']
        self.assertEqual(opened.json()['station'], 'Station 1')

        participant_scan = self.client.post(
            '/api/verify-nfc/', {'nfc_uid': participant.nfc_uid},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(participant_scan.status_code, 200, participant_scan.json())
        open_log = AccessLog.objects.get(user=participant)
        self.assertEqual(open_log.action, AccessLog.AccessActionChoices.OPEN)
        self.assertEqual(open_log.cabinet_session_id, session_id)

        finish_open = self.client.post(
            '/api/cabinet/workflow/', {'command': 'finish_open', 'station': 'Station 1'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(finish_open.status_code, 200, finish_open.json())
        station_two_open = self.client.post(
            '/api/cabinet/workflow/', {'command': 'open', 'station': 'Station 2'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(station_two_open.status_code, 200, station_two_open.json())
        station_two_scan = self.client.post(
            '/api/verify-nfc/', {'nfc_uid': participant.nfc_uid},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(station_two_scan.status_code, 200, station_two_scan.json())
        self.assertEqual(AccessLog.objects.filter(user=participant).latest('access_time').station, 'Station 2')
        station_two_finish = self.client.post(
            '/api/cabinet/workflow/', {'command': 'finish_open', 'station': 'Station 2'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(station_two_finish.status_code, 200, station_two_finish.json())
        both_occupied = self.client.get(
            '/api/cabinet/workflow/', HTTP_X_API_KEY='reader-workflow-secret',
        )
        self.assertEqual(
            [(item['name'], item['status']) for item in both_occupied.json()['stations']],
            [('Station 1', 'occupied'), ('Station 2', 'occupied')],
        )
        self.client.post(
            '/api/cabinet/workflow/', {'command': 'start_close', 'station': 'Station 1'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )

        rejected_scan = self.client.post(
            '/api/verify-nfc/', {'nfc_uid': outsider.nfc_uid},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(rejected_scan.status_code, 403, rejected_scan.json())
        rejected_log = AccessLog.objects.get(user=outsider)
        self.assertEqual(rejected_log.status, AccessLog.AccessStatusChoices.REJECTED)
        self.assertEqual(rejected_log.action, AccessLog.AccessActionChoices.CLOSE)
        self.assertEqual(rejected_log.reason, 'Participant is not part of this cabinet session')

        closing_scan = self.client.post(
            '/api/verify-nfc/', {'nfc_uid': participant.nfc_uid},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(closing_scan.status_code, 200, closing_scan.json())
        close_log = AccessLog.objects.filter(user=participant).latest('access_time')
        self.assertEqual(close_log.action, AccessLog.AccessActionChoices.CLOSE)
        self.assertEqual(close_log.reason, 'Cabinet close attendance recorded')

        closed = self.client.post(
            '/api/cabinet/workflow/', {'command': 'finish_close', 'station': 'Station 1'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(closed.status_code, 200, closed.json())
        self.assertEqual(closed.json()['session']['status'], CabinetSession.StatusChoices.CLOSED)
        station_one_session = CabinetSession.objects.get(pk=session_id)
        station_two_session = CabinetSession.objects.get(pk=station_two_open.json()['session']['id'])
        self.assertEqual(station_one_session.status, CabinetSession.StatusChoices.CLOSED)
        self.assertEqual(station_two_session.status, CabinetSession.StatusChoices.OPEN)

        start_station_two_close = self.client.post(
            '/api/cabinet/workflow/', {'command': 'start_close', 'station': 'Station 2'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(start_station_two_close.status_code, 200, start_station_two_close.json())
        station_two_closing_scan = self.client.post(
            '/api/verify-nfc/', {'nfc_uid': participant.nfc_uid},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(station_two_closing_scan.status_code, 200, station_two_closing_scan.json())
        self.assertEqual(station_two_closing_scan.json()['station']['name'], 'Station 2')
        finish_station_two_close = self.client.post(
            '/api/cabinet/workflow/', {'command': 'finish_close', 'station': 'Station 2'},
            HTTP_X_API_KEY='reader-workflow-secret', format='json',
        )
        self.assertEqual(finish_station_two_close.status_code, 200, finish_station_two_close.json())

        all_available = self.client.get(
            '/api/cabinet/workflow/', HTTP_X_API_KEY='reader-workflow-secret',
        )
        self.assertEqual(
            [(item['name'], item['status']) for item in all_available.json()['stations']],
            [('Station 1', 'available'), ('Station 2', 'available')],
        )

    def test_duplicate_participant_scan_is_recorded_as_duplicate(self):
        student = User.objects.create_user(
            username='cabinet-duplicate-student',
            email='cabinet-duplicate@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='CAB-ACCESS-DUPLICATE',
            nfc_uid='CARD-CABINET-DUPLICATE',
        )
        session = CabinetSession.objects.create(station='Station 1', status=CabinetSession.StatusChoices.OPEN)
        session.opened_by.add(student)

        first = self.client.post('/api/verify-nfc/', {'nfc_uid': student.nfc_uid}, HTTP_X_API_KEY=self.device_api_key, format='json')
        duplicate = self.client.post('/api/verify-nfc/', {'nfc_uid': student.nfc_uid}, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(first.status_code, 200, first.json())
        self.assertEqual(duplicate.status_code, 409, duplicate.json())
        log = student.access_logs.order_by('-access_time').first()
        self.assertEqual(log.status, AccessLog.AccessStatusChoices.DUPLICATE)
        self.assertEqual(log.reason, 'Duplicate participant scan')
        self.assertEqual(log.cabinet_session, session)
        self.assertEqual(log.station, 'Station 1')
        event = CabinetEvent.objects.get(details__access_log_id=log.pk)
        self.assertEqual(event.user_id, student.pk)
        self.assertEqual(event.event_type, 'access_denied')

    def test_multiple_valid_cabinet_scans_create_multiple_access_logs(self):
        student = User.objects.create_user(
            username='cabinet-repeat-student',
            email='cabinet-repeat@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='CAB-ACCESS-002',
            nfc_uid='CARD-CABINET-ACCESS-002',
        )

        for _ in range(2):
            response = self.client.post('/api/verify-nfc/', {
                'nfc_uid': student.nfc_uid,
            }, HTTP_X_API_KEY=self.device_api_key, format='json')
            self.assertEqual(response.status_code, 200, response.json())

        self.assertEqual(student.access_logs.filter(status='success').count(), 2)
        events = list(student.cabinet_events.order_by('timestamp'))
        self.assertEqual(len(events), 2)
        self.assertEqual({event.user_id for event in events}, {student.pk})
        self.assertEqual({event.event_type for event in events}, {'access_granted'})
        for event in events:
            self.assertTrue(student.access_logs.filter(pk=event.details['access_log_id']).exists())

    def test_invalid_cabinet_nfc_scan_creates_no_success_log(self):
        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'CARD-UNKNOWN-999',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 404, response.json())
        self.assertFalse(AccessLog.objects.filter(status='success').exists())
        log = AccessLog.objects.get()
        self.assertIsNone(log.user)
        self.assertEqual(log.nfc_uid, 'CARD-UNKNOWN-999')
        self.assertEqual(log.status, AccessLog.AccessStatusChoices.UNREGISTERED)
        self.assertEqual(log.action, AccessLog.AccessActionChoices.SCAN)
        self.assertEqual(log.reason, 'NFC UID is not registered')
        self.assertFalse(CabinetEvent.objects.exists())

    def test_unknown_nfc_scan_creates_temporary_enrollment_session(self):
        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'card-enrollment-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 404, response.json())
        payload = response.json()
        self.assertFalse(payload['registered'])
        self.assertTrue(payload['registration_required'])
        self.assertNotIn('card-enrollment-001', payload['registration_url'])

        enrollment = NFCEnrollmentSession.objects.get(nfc_uid='CARD-ENROLLMENT-001')
        token = parse_qs(urlparse(payload['registration_url']).query)['token'][0]
        validation = self.client.get('/api/cabinet/enrollment/validate/', {'token': token})

        self.assertEqual(validation.status_code, 200, validation.json())
        self.assertTrue(validation.json()['valid'])
        self.assertTrue(enrollment.verify_token(token))

    @override_settings(NFC_REGISTRATION_URL_BASE='https://frontend.example/register')
    def test_new_enrollment_urls_use_configured_base_and_preserve_valid_token(self):
        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'card-configured-url-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 404, response.json())
        registration_url = response.json()['registration_url']
        parsed_url = urlparse(registration_url)
        token = parse_qs(parsed_url.query)['token'][0]
        enrollment = NFCEnrollmentSession.objects.get(nfc_uid='CARD-CONFIGURED-URL-001')
        self.assertEqual((parsed_url.scheme, parsed_url.netloc, parsed_url.path), (
            'https', 'frontend.example', '/register',
        ))
        self.assertTrue(enrollment.verify_token(token))
        self.assertNotIn('localhost:5176', registration_url)
        self.assertNotIn(':5000', registration_url)

        with self.settings(NFC_REGISTRATION_URL_BASE='http://registration.example:8080/register'):
            changed = self.client.post('/api/verify-nfc/', {
                'nfc_uid': 'card-configured-url-002',
            }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(changed.status_code, 404, changed.json())
        changed_url = urlparse(changed.json()['registration_url'])
        changed_token = parse_qs(changed_url.query)['token'][0]
        changed_enrollment = NFCEnrollmentSession.objects.get(nfc_uid='CARD-CONFIGURED-URL-002')
        self.assertEqual((changed_url.scheme, changed_url.netloc, changed_url.path), (
            'http', 'registration.example:8080', '/register',
        ))
        self.assertTrue(changed_enrollment.verify_token(changed_token))

    def test_repeated_unknown_nfc_scans_reuse_one_pending_session(self):
        first = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'CARD-REUSE-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        second = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'CARD-REUSE-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(first.status_code, 404, first.json())
        self.assertEqual(second.status_code, 404, second.json())
        self.assertEqual(
            NFCEnrollmentSession.objects.filter(
                nfc_uid='CARD-REUSE-001',
                status=NFCEnrollmentSession.StatusChoices.PENDING,
            ).count(),
            1,
        )
        first_token = parse_qs(urlparse(first.json()['registration_url']).query)['token'][0]
        second_token = parse_qs(urlparse(second.json()['registration_url']).query)['token'][0]
        self.assertNotEqual(first_token, second_token)
        self.assertEqual(self.client.get('/api/cabinet/enrollment/validate/', {'token': first_token}).status_code, 410)
        self.assertEqual(self.client.get('/api/cabinet/enrollment/validate/', {'token': second_token}).status_code, 200)

    def test_invalid_expired_and_completed_enrollment_tokens_are_rejected(self):
        invalid = self.client.get('/api/cabinet/enrollment/validate/', {'token': 'invalid-token'})
        self.assertEqual(invalid.status_code, 410)

        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-002',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        enrollment.set_token('expired-token')
        enrollment.save()
        expired = self.client.get('/api/cabinet/enrollment/validate/', {'token': 'expired-token'})
        self.assertEqual(expired.status_code, 410)
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.EXPIRED)

        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-003',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() - timedelta(minutes=1),
            status=NFCEnrollmentSession.StatusChoices.COMPLETED,
        )
        enrollment.set_token('completed-token')
        enrollment.save()
        completed = self.client.get('/api/cabinet/enrollment/validate/', {'token': 'completed-token'})
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()['status'], 'completed')

    def test_pending_student_registration_links_nfc_and_consumes_token(self):
        student = User.objects.create_user(
            username='pending-registration-student',
            email='pending-registration@example.com',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='PENDING-001',
            nfc_uid=None,
            is_active=True,
            first_name='Roster',
            last_name='Student',
        )
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-READY',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('registration-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'registration-token',
            'role': 'student',
            'username': 'pending_student',
            'student_id': 'PENDING-001',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })

        self.assertEqual(response.status_code, 201, response.json())
        student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertEqual(student.nfc_uid, 'CARD-ENROLLMENT-READY')
        self.assertEqual(student.username, 'pending_student')
        self.assertEqual(student.get_full_name(), 'Roster Student')
        self.assertEqual(student.email, 'pending-registration@example.com')
        self.assertTrue(student.has_usable_password())
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.COMPLETED)

        reused = register_nfc_with_email_code(self.client, {
            'token': 'registration-token',
            'role': 'student',
            'username': 'pending_student',
            'student_id': 'PENDING-001',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })
        self.assertEqual(reused.status_code, 410, reused.json())

    def test_enrollment_registration_rejects_taken_username_without_consuming_token(self):
        User.objects.create_user(
            username='claimed_username',
            email='claimed.username@example.com',
            password='existing-password',
            role=User.RoleChoices.STUDENT,
            student_id='CLAIMED-USERNAME-001',
        )
        pending_student = User.objects.create_user(
            username='pending_username_owner',
            email='pending.username@example.com',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='PENDING-USERNAME-001',
        )
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-USERNAME-CONFLICT',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('username-conflict-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'username-conflict-token',
            'role': 'student',
            'username': 'claimed_username',
            'student_id': pending_student.student_id,
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })

        self.assertEqual(response.status_code, 409, response.json())
        self.assertEqual(response.json()['error'], 'That username is already in use.')
        pending_student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertIsNone(pending_student.nfc_uid)
        self.assertFalse(pending_student.has_usable_password())
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)

    def test_enrollment_registration_requires_username_and_minimum_password(self):
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-REQUIRED-REGISTRATION-FIELDS',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('required-fields-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'required-fields-token',
            'role': 'student',
            'student_id': 'PENDING-REQUIRED-001',
            'password': 'short',
            'confirm_password': 'short',
        })

        self.assertEqual(response.status_code, 400, response.json())
        self.assertIn('username', response.json())
        self.assertIn('password', response.json())

    def test_enrollment_registration_rejects_unknown_student_id(self):
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-UNKNOWN-STUDENT',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('unknown-student-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'unknown-student-token',
            'role': 'student',
            'username': 'unknown_student',
            'student_id': 'DOES-NOT-EXIST',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })

        self.assertEqual(response.status_code, 404, response.json())

    def test_enrollment_registration_rejects_existing_nfc_owner(self):
        User.objects.create_user(
            username='other-nfc-owner',
            email='other-nfc-owner@example.com',
            password='existing-password',
            role=User.RoleChoices.STUDENT,
            student_id='OWNER-001',
            nfc_uid='CARD-ALREADY-ASSIGNED',
        )
        User.objects.create_user(
            username='pending-nfc-student',
            email='pending-nfc-student@example.com',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='PENDING-002',
            nfc_uid=None,
        )
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ALREADY-ASSIGNED',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('assigned-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'assigned-token',
            'role': 'student',
            'username': 'pending_nfc_student',
            'student_id': 'PENDING-002',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })
        self.assertEqual(response.status_code, 409, response.json())

    def test_enrollment_registration_rejects_existing_account(self):
        User.objects.create_user(
            username='existing-account-student',
            email='existing-account@example.com',
            password='existing-password',
            role=User.RoleChoices.STUDENT,
            student_id='EXISTING-001',
            nfc_uid=None,
        )
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-EXISTING-ACCOUNT',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('existing-account-token')
        enrollment.save()

        response = register_nfc_with_email_code(self.client, {
            'token': 'existing-account-token',
            'username': 'existing_account_student',
            'role': 'student',
            'student_id': 'EXISTING-001',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        })
        self.assertEqual(response.status_code, 409, response.json())


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    TAPTRACK_NFC_DEVICE_MAP=[{
        'device_id': 'ENROLLMENT-TEST-READER',
        'api_key': 'nfc-enrollment-device-key',
        'station': 'Station 1',
        'cabinet_name': 'Cabinet 1',
        'active': True,
    }],
)
class NFCEnrollmentRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        mail.outbox.clear()
        self.client = APIClient()
        self.device_api_key = 'nfc-enrollment-device-key'
        self.previous_device_key = os.environ.get('DEVICE_API_KEY')
        os.environ['DEVICE_API_KEY'] = self.device_api_key
        self.section = Section.objects.create(
            section_name='Identity Test Section',
            subject_code='ID-101',
            program='Computer Science',
            academic_year='2026-2027',
        )

    def tearDown(self):
        if self.previous_device_key is None:
            os.environ.pop('DEVICE_API_KEY', None)
        else:
            os.environ['DEVICE_API_KEY'] = self.previous_device_key

    def test_unregistered_card_always_starts_registration_qr_session(self):
        pending = User.objects.create_user(
            username='pending-no-card',
            email='pending-no-card@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='NO-CARD-PENDING-001',
        )
        pending.set_unusable_password()
        pending.save(update_fields=['password'])
        response = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': 'BRAND-NEW-CARD'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(response.status_code, 404, response.json())
        self.assertTrue(response.json()['registration_required'])
        self.assertIn('/register?token=', response.json()['registration_url'])
        expires_at = datetime.fromisoformat(response.json()['expires_at'].replace('Z', '+00:00'))
        server_time = datetime.fromisoformat(response.json()['server_time'].replace('Z', '+00:00'))
        self.assertEqual(expires_at - server_time, timedelta(seconds=600))

    def test_enrollment_lifetime_is_exactly_600_seconds(self):
        pending = User.objects.create_user(
            username='enrollment-expires-pending',
            email='enrollment-expires@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='EXPIRES-600-001',
            nfc_uid='ENROLLMENT-600-CARD',
        )
        pending.set_unusable_password()
        pending.save(update_fields=['password'])
        before = timezone.now()
        response = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': 'ENROLLMENT-600-CARD'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        after = timezone.now()
        self.assertEqual(response.status_code, 404, response.json())
        expires_at = datetime.fromisoformat(response.json()['expires_at'].replace('Z', '+00:00'))
        server_time = datetime.fromisoformat(response.json()['server_time'].replace('Z', '+00:00'))
        self.assertGreaterEqual(expires_at, before + timedelta(seconds=600))
        self.assertLessEqual(expires_at, after + timedelta(seconds=600))
        self.assertEqual(expires_at - server_time, timedelta(seconds=600))

    def make_enrollment(self, uid, token):
        enrollment = NFCEnrollmentSession(
            nfc_uid=uid,
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        enrollment.set_token(token)
        enrollment.completion_expires_at = enrollment.expires_at
        enrollment.save()
        return enrollment

    def test_cancellation_revokes_pending_but_not_completed_enrollment(self):
        pending = self.make_enrollment('CANCEL-PENDING-CARD', 'pending-cancel-token')
        cancelled = self.client.post(
            '/api/cabinet/enrollment/cancel/',
            {'token': 'pending-cancel-token'},
            format='json',
        )
        self.assertEqual(cancelled.status_code, 200)
        self.assertTrue(cancelled.json()['cancelled'])
        pending.refresh_from_db()
        self.assertEqual(pending.status, NFCEnrollmentSession.StatusChoices.CANCELLED)

        completed_session = self.make_enrollment('CANCEL-COMPLETED-CARD', 'completed-cancel-token')
        completed_session.status = NFCEnrollmentSession.StatusChoices.COMPLETED
        completed_session.save(update_fields=['status'])
        not_cancelled = self.client.post(
            '/api/cabinet/enrollment/cancel/',
            {'token': 'completed-cancel-token'},
            format='json',
        )
        self.assertEqual(not_cancelled.status_code, 200)
        self.assertFalse(not_cancelled.json()['cancelled'])
        completed_session.refresh_from_db()
        self.assertEqual(completed_session.status, NFCEnrollmentSession.StatusChoices.COMPLETED)

    def register(self, token, role, identifier_field, identifier, username, password, confirm_password=None):
        return register_nfc_with_email_code(self.client, {
            'token': token,
            'role': role,
            identifier_field: identifier,
            'username': username,
            'password': password,
            'confirm_password': confirm_password if confirm_password is not None else password,
        })

    def test_student_registration_binds_existing_roster_record(self):
        student = User.objects.create_user(
            username='enrollment-student-roster',
            email='enrollment-student@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-STUDENT-001',
            section=self.section,
            first_name='Taylor',
            last_name='Student',
        )
        enrollment = self.make_enrollment('IDENTITY-STUDENT-CARD', 'student-identity-token')

        student.refresh_from_db()
        self.assertIsNone(student.nfc_uid)

        registration = self.register(
            'student-identity-token', 'student', 'student_id', student.student_id,
            'taylor_student', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(registration.status_code, 201, registration.json())
        self.assertTrue(registration.json()['nfc_registered'])
        self.assertNotIn('nfc_uid', registration.json())

        student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertEqual(student.nfc_uid, 'IDENTITY-STUDENT-CARD')
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.COMPLETED)
        scan = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': 'IDENTITY-STUDENT-CARD'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(scan.status_code, 200, scan.json())
        self.assertEqual(scan.json()['student_id'], student.student_id)

    def test_instructor_registration_binds_existing_roster_record(self):
        instructor = User.objects.create_user(
            username='enrollment-instructor-roster',
            email='enrollment-instructor@example.test',
            password=None,
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='IDENTITY-INSTRUCTOR-001',
            first_name='Rae',
            last_name='Instructor',
        )
        instructor.assigned_sections.add(self.section)
        self.make_enrollment('IDENTITY-INSTRUCTOR-CARD', 'instructor-identity-token')

        registration = self.register(
            'instructor-identity-token', 'instructor', 'instructor_id', instructor.instructor_id,
            'rae_instructor', 'Orbit!72-MapleCipher',
        )
        self.assertEqual(registration.status_code, 201, registration.json())
        self.assertEqual(registration.json()['role'], 'instructor')
        self.assertEqual(registration.json()['name'], 'Rae Instructor')
        self.assertEqual(registration.json()['instructor_id'], instructor.instructor_id)
        self.assertTrue(registration.json()['nfc_registered'])
        instructor.refresh_from_db()
        self.assertEqual(instructor.nfc_uid, 'IDENTITY-INSTRUCTOR-CARD')
        scan = self.client.post(
            '/api/verify-nfc/',
            {'nfc_uid': 'IDENTITY-INSTRUCTOR-CARD'},
            HTTP_X_API_KEY=self.device_api_key,
            format='json',
        )
        self.assertEqual(scan.status_code, 200, scan.json())
        self.assertEqual(scan.json()['role'], 'instructor')

    def test_unknown_id_and_wrong_role_do_not_register_an_account(self):
        student = User.objects.create_user(
            username='enrollment-privacy-student',
            email='enrollment-privacy@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-PRIVACY-001',
        )
        enrollment = self.make_enrollment('IDENTITY-PRIVACY-CARD', 'privacy-identity-token')

        unknown = self.register(
            'privacy-identity-token', 'student', 'student_id', 'NOT-A-REAL-ID',
            'unknown_user', 'Cobalt!93-RiverQuartz',
        )
        wrong_role = self.register(
            'privacy-identity-token', 'instructor', 'instructor_id', student.student_id,
            'wrong_role_user', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(unknown.status_code, 400, unknown.json())
        self.assertEqual(wrong_role.status_code, 400, wrong_role.json())
        self.assertNotIn('name', unknown.json())
        self.assertNotIn('email', unknown.json())
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)
        self.assertIsNone(student.nfc_uid)

    def test_existing_account_and_duplicate_card_are_rejected(self):
        already_registered = User.objects.create_user(
            username='already-registered',
            email='already-registered@example.test',
            password='ExistingPassword!901',
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-ALREADY-001',
        )
        pending = User.objects.create_user(
            username='pending-duplicate-card',
            email='pending-duplicate-card@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-PENDING-002',
        )
        existing_card_owner = User.objects.create_user(
            username='existing-card-owner',
            email='existing-card-owner@example.test',
            password='ExistingPassword!902',
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-CARD-OWNER-003',
            nfc_uid='IDENTITY-DUPLICATE-CARD',
        )
        account_enrollment = self.make_enrollment('IDENTITY-ACCOUNT-CARD', 'already-registered-token')
        card_enrollment = self.make_enrollment('IDENTITY-DUPLICATE-CARD', 'duplicate-card-token')

        account_result = self.register(
            'already-registered-token', 'student', 'student_id', already_registered.student_id,
            'new_username', 'Cobalt!93-RiverQuartz',
        )
        card_result = self.register(
            'duplicate-card-token', 'student', 'student_id', pending.student_id,
            'pending_duplicate', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(account_result.status_code, 409, account_result.json())
        self.assertEqual(card_result.status_code, 400, card_result.json())
        already_registered.refresh_from_db()
        pending.refresh_from_db()
        account_enrollment.refresh_from_db()
        card_enrollment.refresh_from_db()
        self.assertIsNone(already_registered.nfc_uid)
        self.assertIsNone(pending.nfc_uid)
        self.assertEqual(account_enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)
        self.assertEqual(card_enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)
        self.assertEqual(existing_card_owner.nfc_uid, 'IDENTITY-DUPLICATE-CARD')

    def test_admin_assigned_card_cannot_be_claimed_from_a_different_scan(self):
        assigned_student = User.objects.create_user(
            username='admin-assigned-card-student',
            email='admin-assigned-card@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-ASSIGNED-001',
            nfc_uid='IDENTITY-ADMIN-ASSIGNED-CARD',
        )
        wrong_card = self.make_enrollment('IDENTITY-DIFFERENT-CARD', 'different-card-token')
        assigned_card = self.make_enrollment('IDENTITY-ADMIN-ASSIGNED-CARD', 'assigned-card-token')
        assigned_card.registration_target_user = assigned_student
        assigned_card.save(update_fields=['registration_target_user'])

        wrong_registration = self.register(
            'different-card-token', 'student', 'student_id', assigned_student.student_id,
            'different_card_claim', 'Cobalt!93-RiverQuartz',
        )

        self.assertEqual(wrong_registration.status_code, 400, wrong_registration.json())
        assigned_student.refresh_from_db()
        wrong_card.refresh_from_db()
        self.assertFalse(assigned_student.has_usable_password())
        self.assertEqual(wrong_card.status, NFCEnrollmentSession.StatusChoices.PENDING)

        correct_registration = self.register(
            'assigned-card-token', 'student', 'student_id', assigned_student.student_id,
            'assigned_card_owner', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(correct_registration.status_code, 201, correct_registration.json())

    def test_inactive_roster_account_cannot_register_a_card(self):
        inactive_student = User.objects.create_user(
            username='inactive-enrollment-student',
            email='inactive-enrollment@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-INACTIVE-001',
            is_active=False,
        )
        enrollment = self.make_enrollment('IDENTITY-INACTIVE-CARD', 'inactive-enrollment-token')

        response = self.register(
            'inactive-enrollment-token', 'student', 'student_id', inactive_student.student_id,
            'inactive_student', 'Cobalt!93-RiverQuartz',
        )

        self.assertEqual(response.status_code, 400, response.json())
        inactive_student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertIsNone(inactive_student.nfc_uid)
        self.assertFalse(inactive_student.has_usable_password())
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)

    def test_expired_and_reused_enrollment_tokens_are_rejected(self):
        student = User.objects.create_user(
            username='enrollment-token-student',
            email='enrollment-token-student@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-TOKEN-001',
        )
        expired = self.make_enrollment('IDENTITY-EXPIRED-TOKEN-CARD', 'expired-enrollment-token')
        expired.expires_at = timezone.now() - timedelta(seconds=1)
        expired.save(update_fields=['expires_at'])
        expired_result = self.register(
            'expired-enrollment-token', 'student', 'student_id', student.student_id,
            'expired_user', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(expired_result.status_code, 410, expired_result.json())
        expired.refresh_from_db()
        self.assertEqual(expired.status, NFCEnrollmentSession.StatusChoices.EXPIRED)

        current = self.make_enrollment('IDENTITY-CURRENT-TOKEN-CARD', 'single-use-token')
        first_result = self.register(
            'single-use-token', 'student', 'student_id', student.student_id,
            'token_student', 'Cobalt!93-RiverQuartz',
        )
        reused_result = self.register(
            'single-use-token', 'student', 'student_id', student.student_id,
            'token_student', 'Cobalt!93-RiverQuartz',
        )
        self.assertEqual(first_result.status_code, 201, first_result.json())
        self.assertEqual(reused_result.status_code, 410, reused_result.json())
        current.refresh_from_db()
        self.assertEqual(current.status, NFCEnrollmentSession.StatusChoices.COMPLETED)

    def test_registration_rolls_back_account_and_session_when_log_fails(self):
        student = User.objects.create_user(
            username='enrollment-rollback-student',
            email='enrollment-rollback@example.test',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='IDENTITY-ROLLBACK-001',
        )
        enrollment = self.make_enrollment('IDENTITY-ROLLBACK-CARD', 'rollback-registration-token')

        with patch('api.views.AccessLog.objects.create', side_effect=IntegrityError('simulated log failure')):
            response = self.register(
                'rollback-registration-token', 'student', 'student_id', student.student_id,
                'rollback_user', 'Cobalt!93-RiverQuartz',
            )

        self.assertEqual(response.status_code, 400, response.json())
        student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertIsNone(student.nfc_uid)
        self.assertFalse(student.has_usable_password())
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.PENDING)
