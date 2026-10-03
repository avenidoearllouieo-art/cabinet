from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from io import BytesIO
import os
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from openpyxl import Workbook, load_workbook

from .models import AccessLog, Notification, Section, User, Activity, ActivityAttachment, Submission, PasswordResetRequest, NFCEnrollmentSession


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

    def test_create_instructor_accepts_ids_and_returns_section_objects(self):
        response = self.client.post('/api/users/', {
            'username': 'created-instructor',
            'email': 'created-instructor@example.com',
            'password': 'secret1234',
            'role': User.RoleChoices.INSTRUCTOR,
            'instructor_id': 'INST-003',
            'assigned_sections': [self.section_a.pk, self.section_b.pk],
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        created = User.objects.get(pk=response.json()['id'])
        self.assertEqual(
            {item['section_id'] for item in response.json()['assigned_sections']},
            {self.section_a.pk, self.section_b.pk},
        )
        self.assertEqual(set(created.assigned_sections.values_list('pk', flat=True)), {self.section_a.pk, self.section_b.pk})
        self.assertFalse(created.check_password('created-instructor'))
        self.assertTrue(created.check_password('secret1234'))
        self.assertFalse(Section.objects.filter(pk__in=[self.section_a.pk, self.section_b.pk]).exclude(instructor=created).exists())

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

    def test_legacy_section_owner_is_included_in_user_response(self):
        self.section_a.instructor = self.first_instructor
        self.section_a.save(update_fields=['instructor'])

        response = self.client.get(f'/api/users/{self.first_instructor.pk}/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(
            [item['section_id'] for item in response.json()['assigned_sections']],
            [self.section_a.pk],
        )


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
        file_upload = SimpleUploadedFile('brief.pdf', b'file-content', content_type='application/pdf')

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
        activity = Activity.objects.get(id=data['id'])
        self.assertTrue(activity.attachments.exists())

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

        new_file = SimpleUploadedFile('new.pdf', b'new', content_type='application/pdf')
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
        )

    def test_student_can_view_own_profile(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/users/profile/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], self.student.id)
        self.assertEqual(response.json()['student_id'], 'S005')

    def test_student_can_update_editable_profile_fields(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.patch('/api/users/update_profile/', {
            'email': 'updated@example.com',
            'contact_number': '09171234567',
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['email'], 'updated@example.com')
        self.assertEqual(response.json()['contact_number'], '09171234567')


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
        from .admin import SubmissionAdmin
        from .models import Submission, User

        admin_instance = SubmissionAdmin(Submission, admin.site)
        field = admin_instance.formfield_for_foreignkey(Submission._meta.get_field('student'), None)
        self.assertEqual(field.queryset.filter(role=User.RoleChoices.STUDENT).count(), field.queryset.count())


class StudentWorkbookImportTests(TestCase):
    def setUp(self):
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
            ('student_id', 'first_name', 'last_name', 'email', 'username', 'subject_code', 'role', 'active'),
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
        self.assertEqual(SectionSerializer(self.section).data['subject_code'], 'XLSX-TEST')
        self.assertEqual(Section._meta.get_field('subject_code').verbose_name, 'Subject Code')
        self.assertFalse(User.objects.filter(student_id='DEMO-STUDENT-001').exists())

    def test_duplicate_student_id_and_email_inside_workbook_are_rejected(self):
        headers = ['student_id', 'first_name', 'last_name', 'email']
        rows = [
            ['DUP-100', 'Avery', 'Example', 'same@example.com'],
            ['DUP-100', 'Casey', 'Example', 'same@example.com'],
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
            ['student_id', 'first_name', 'last_name', 'email'],
            [['EXISTING-100', 'Changed', 'Name', 'changed@example.com']],
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
            ['student_id', 'first_name', 'last_name', 'email'],
            [['EMAIL-101', 'Avery', 'Example', 'already.used@example.com']],
        )

        self.assertTrue(any(error['column'] == 'email' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='EMAIL-101').exists())

    def test_existing_username_is_rejected(self):
        User.objects.create_user(
            username='chosen_username',
            email='username.owner@example.com',
            password=None,
            student_id='USERNAME-OWNER-100',
            role=User.RoleChoices.STUDENT,
        )
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'username'],
            [['USERNAME-NEW-100', 'Avery', 'Example', 'new.username@example.com', 'chosen_username']],
        )

        self.assertTrue(any(error['column'] == 'username' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='USERNAME-NEW-100').exists())

    def test_invalid_subject_code_reports_row_and_imports_nothing(self):
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'subject_code'],
            [
                ['SECTION-VALID-100', 'Casey', 'Example', 'casey.section@example.com', ''],
                ['SECTION-INVALID-100', 'Avery', 'Example', 'avery.section@example.com', 'MISSING-SECTION'],
            ],
        )

        self.assertTrue(any(error['row'] == 3 and error['column'] == 'subject_code' for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id__in=['SECTION-VALID-100', 'SECTION-INVALID-100']).exists())

    def test_ambiguous_subject_code_is_rejected(self):
        Section.objects.create(subject_code='DUPLICATE-CODE', section_name='Duplicate Section One')
        Section.objects.create(subject_code='duplicate-code', section_name='Duplicate Section Two')
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'subject_code'],
            [['SECTION-DUP-100', 'Avery', 'Example', 'section.duplicate@example.com', 'Duplicate-Code']],
        )

        self.assertTrue(any(error['column'] == 'subject_code' and 'More than one' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='SECTION-DUP-100').exists())

    def test_nfc_uid_and_password_columns_are_not_accepted(self):
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'nfc_uid', 'password'],
            [['SECURITY-100', 'Avery', 'Example', 'security@example.com', 'NFC-UID', 'do-not-import']],
        )

        self.assertTrue(any(error['column'] == 'header' and 'Unsupported column' in error['message'] for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id='SECURITY-100').exists())

    def test_invalid_email_and_active_values_are_rejected(self):
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'active'],
            [['BAD-100', 'Avery', 'Example', 'not-an-email', 'sometimes']],
        )

        self.assertEqual({error['column'] for error in response.context['errors']}, {'email', 'active'})
        self.assertFalse(User.objects.filter(student_id='BAD-100').exists())

    def test_duplicate_generated_username_is_rejected(self):
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email'],
            [
                ['SAME USER', 'Avery', 'Example', 'avery.one@example.com'],
                ['SAME_USER', 'Casey', 'Example', 'casey.two@example.com'],
            ],
        )

        self.assertTrue(any(error['column'] == 'username' and error['row'] == 3 for error in response.context['errors']))
        self.assertFalse(User.objects.filter(student_id__in=['SAME USER', 'SAME_USER']).exists())

    def test_successful_import_is_confirmed_atomically_and_uses_unusable_passwords(self):
        response = self.upload(
            ['student_id', 'first_name', 'last_name', 'email', 'username', 'subject_code', 'role', 'active'],
            [
                ['IMPORT-100', 'Avery', 'Example', 'avery.import@example.com', '', 'XLSX-TEST', 'student', 'true'],
                ['IMPORT-101', 'Casey', 'Example', 'casey.import@example.com', 'casey_import_user', '', 'student', 'false'],
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
        self.assertIsNone(students[0].nfc_uid)
        self.assertFalse(students[0].has_usable_password())
        self.assertFalse(students[1].is_active)
        self.assertIsNone(students[1].section)

    def test_imported_student_can_complete_existing_nfc_enrollment_flow(self):
        upload = self.upload(
            ['student_id', 'first_name', 'last_name', 'email'],
            [['ENROLL-100', 'Taylor', 'Example', 'taylor.enroll@example.com']],
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
            registration = self.client.post('/api/cabinet/enrollment/register/', {
                'token': token,
                'student_id': student.student_id,
                'full_name': 'Taylor Example',
                'email': student.email,
                'password': 'Enrollment-Test-Password-123',
                'confirm_password': 'Enrollment-Test-Password-123',
            })
            self.assertEqual(registration.status_code, 201, registration.json())
            verification = self.client.post('/api/verify-nfc/', {'nfc_uid': test_uid}, HTTP_X_API_KEY=device_key)
            self.assertEqual(verification.status_code, 200, verification.json())
            self.assertEqual(verification.json()['student_id'], 'ENROLL-100')
            self.assertEqual(verification.json()['role'], 'student')
        finally:
            if previous_key is None:
                os.environ.pop('DEVICE_API_KEY', None)
            else:
                os.environ['DEVICE_API_KEY'] = previous_key


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
        AccessLog.objects.create(user=self.student, status='success', cabinet_name='Cabinet A', reason='Entry granted', rfid_tag='ABC123')
        AccessLog.objects.create(user=self.other_student, status='failed', cabinet_name='Cabinet B', reason='Denied', rfid_tag='XYZ999')

    def test_student_only_sees_own_access_logs(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/access-logs/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        results = data.get('results', [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['cabinet_name'], 'Cabinet A')
        self.assertEqual(results[0]['user'], self.student.id)

    def test_student_stats_endpoint_returns_private_totals(self):
        self.client.force_authenticate(user=self.student)

        response = self.client.get('/api/access-logs/stats/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['total_accesses_today'], 1)
        self.assertEqual(data['successful_accesses_today'], 1)
        self.assertEqual(data['failed_accesses_today'], 0)


class PasswordResetFlowTests(TestCase):
    def setUp(self):
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

    def test_password_reset_request_is_bound_to_existing_user_and_requires_nfc_verification(self):
        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': 'STU-001',
            'email': 'student-a@example.com',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        payload = response.json()
        self.assertIn('request_id', payload)

        reset_request = PasswordResetRequest.objects.get(request_id=payload['request_id'])
        self.assertEqual(reset_request.user_id, self.student_a.pk)

        handoff_response = self.client.post('/api/auth/password-reset/cabinet-handoff/', {
            'request_id': reset_request.request_id,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(handoff_response.status_code, 200, handoff_response.json())

        verify_response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'student_id': 'STU-001',
            'nfc_uid': 'NFC-USER-001',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(verify_response.status_code, 200, verify_response.json())
        verify_payload = verify_response.json()
        self.assertIn('reset_token', verify_payload)

        validation_response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': verify_payload['reset_token'],
        }, format='json')

        self.assertEqual(validation_response.status_code, 200, validation_response.json())
        validation_payload = validation_response.json()
        self.assertTrue(validation_payload['valid'])
        self.assertIn('reset_authorization', validation_payload)
        self.assertNotIn('reset_token', validation_payload)

        confirm_response = self.client.post('/api/auth/password-reset/confirm/', {
            'request_id': reset_request.request_id,
            'reset_authorization': validation_payload['reset_authorization'],
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!',
        }, format='json')

        self.assertEqual(confirm_response.status_code, 200, confirm_response.json())
        self.student_a.refresh_from_db()
        self.assertTrue(self.student_a.check_password('NewPassword123!'))

    def test_reset_request_rejects_mismatched_student_id_or_nfc_uid(self):
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
            'student_id': 'STU-001',
            'nfc_uid': 'NFC-USER-002',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(mismatched_response.status_code, 403, mismatched_response.json())
        self.assertIn('does not match', mismatched_response.json()['error'])

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
            'student_id': target.student_id,
            'nfc_uid': target.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        return reset_request, verify_response.json()['reset_token']

    def test_invalid_token_is_rejected_without_authorization(self):
        reset_request, _ = self._create_verified_reset_request()

        response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': 'invalid-token',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertNotIn('reset_authorization', response.json())

    def test_expired_token_is_rejected(self):
        reset_request, reset_token = self._create_verified_reset_request()
        reset_request.expires_at = timezone.now() - timedelta(minutes=1)
        reset_request.save(update_fields=['expires_at'])

        response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': reset_token,
        }, format='json')

        self.assertEqual(response.status_code, 410)

    def test_token_cannot_validate_against_another_request(self):
        first_request, reset_token = self._create_verified_reset_request(self.student_a)
        second_request, _ = self._create_verified_reset_request(self.student_b)

        response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': second_request.request_id,
            'reset_token': reset_token,
        }, format='json')

        self.assertEqual(response.status_code, 400)
        first_request.refresh_from_db()
        self.assertEqual(first_request.status, PasswordResetRequest.StatusChoices.VERIFIED)

    def test_used_token_is_rejected(self):
        reset_request, reset_token = self._create_verified_reset_request()
        reset_request.status = PasswordResetRequest.StatusChoices.USED
        reset_request.used_at = timezone.now()
        reset_request.save(update_fields=['status', 'used_at'])

        response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': reset_token,
        }, format='json')

        self.assertEqual(response.status_code, 409)

    def test_expired_authorization_cannot_confirm_password(self):
        reset_request, reset_token = self._create_verified_reset_request()
        validation_response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': reset_token,
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

        self.assertEqual(response.status_code, 400)

    def test_reset_authorization_is_single_use(self):
        reset_request, reset_token = self._create_verified_reset_request()
        validation_response = self.client.post('/api/auth/password-reset/validate-token/', {
            'request_id': reset_request.request_id,
            'reset_token': reset_token,
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
        self.assertEqual(replay_response.status_code, 400)

    def test_nfc_endpoint_requires_device_api_key(self):
        reset_request, _ = self._create_verified_reset_request()

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': reset_request.request_id,
            'student_id': self.student_a.student_id,
            'nfc_uid': self.student_a.nfc_uid,
        }, format='json')

        self.assertEqual(response.status_code, 403)

    def test_password_reset_verify_requires_claimed_cabinet_handoff(self):
        request_response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_a.student_id,
            'email': self.student_a.email,
        }, format='json')
        request_id = request_response.json()['request_id']

        response = self.client.post('/api/auth/password-reset/verify-nfc/', {
            'request_id': request_id,
            'student_id': self.student_a.student_id,
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
        self.assertEqual(second_response.status_code, 409, second_response.json())

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

        nfc_response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': self.student_a.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')
        self.assertEqual(nfc_response.status_code, 200, nfc_response.json())

    def test_password_reset_request_still_works(self):
        response = self.client.post('/api/auth/password-reset/request/', {
            'student_id': self.student_b.student_id,
            'email': self.student_b.email,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertIn('request_id', response.json())


class CabinetDeviceIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.device_api_key = 'cabinet-device-test-key'
        os.environ['DEVICE_API_KEY'] = self.device_api_key
        self.section = Section.objects.create(section_name='Cabinet Section', subject_code='CAB-101')

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

        registration = self.client.post('/api/cabinet/enrollment/register/', {
            'token': token,
            'student_id': student.student_id,
            'full_name': 'Jordan Santos',
            'email': student.email,
            'password': 'Fixture-Only-Password-123',
            'confirm_password': 'Fixture-Only-Password-123',
        }, format='json')
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

    def test_valid_cabinet_nfc_scan_creates_successful_access_log(self):
        student = User.objects.create_user(
            username='cabinet-access-student',
            email='cabinet-access@example.com',
            password='secret1234',
            role=User.RoleChoices.STUDENT,
            student_id='CAB-ACCESS-001',
            nfc_uid='CARD-CABINET-ACCESS-001',
        )

        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': student.nfc_uid,
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(student.access_logs.filter(status='success').count(), 1)

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

    def test_invalid_cabinet_nfc_scan_creates_no_success_log(self):
        response = self.client.post('/api/verify-nfc/', {
            'nfc_uid': 'CARD-UNKNOWN-999',
        }, HTTP_X_API_KEY=self.device_api_key, format='json')

        self.assertEqual(response.status_code, 404, response.json())
        self.assertFalse(AccessLog.objects.filter(status='success').exists())
        self.assertEqual(AccessLog.objects.filter(status='failed').count(), 1)

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
            expires_at=timezone.now() + timedelta(minutes=15),
            status=NFCEnrollmentSession.StatusChoices.COMPLETED,
        )
        enrollment.set_token('completed-token')
        enrollment.save()
        completed = self.client.get('/api/cabinet/enrollment/validate/', {'token': 'completed-token'})
        self.assertEqual(completed.status_code, 410)

    def test_pending_student_registration_links_nfc_and_consumes_token(self):
        student = User.objects.create_user(
            username='pending-registration-student',
            email='pending-registration@example.com',
            password=None,
            role=User.RoleChoices.STUDENT,
            student_id='PENDING-001',
            nfc_uid=None,
            is_active=True,
        )
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-READY',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('registration-token')
        enrollment.save()

        response = self.client.post('/api/cabinet/enrollment/register/', {
            'token': 'registration-token',
            'student_id': 'PENDING-001',
            'full_name': 'Pending Student',
            'email': 'pending.registration@example.com',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        }, format='json')

        self.assertEqual(response.status_code, 201, response.json())
        student.refresh_from_db()
        enrollment.refresh_from_db()
        self.assertEqual(student.nfc_uid, 'CARD-ENROLLMENT-READY')
        self.assertTrue(student.has_usable_password())
        self.assertEqual(enrollment.status, NFCEnrollmentSession.StatusChoices.COMPLETED)

        reused = self.client.post('/api/cabinet/enrollment/register/', {
            'token': 'registration-token',
            'student_id': 'PENDING-001',
            'full_name': 'Pending Student',
            'email': 'pending.registration@example.com',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        }, format='json')
        self.assertEqual(reused.status_code, 410, reused.json())

    def test_enrollment_registration_rejects_unknown_student_id(self):
        enrollment = NFCEnrollmentSession(
            nfc_uid='CARD-ENROLLMENT-UNKNOWN-STUDENT',
            token_digest='',
            token_hash='',
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        enrollment.set_token('unknown-student-token')
        enrollment.save()

        response = self.client.post('/api/cabinet/enrollment/register/', {
            'token': 'unknown-student-token',
            'student_id': 'DOES-NOT-EXIST',
            'full_name': 'Unknown Student',
            'email': 'unknown.student@example.com',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        }, format='json')

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

        response = self.client.post('/api/cabinet/enrollment/register/', {
            'token': 'assigned-token',
            'student_id': 'PENDING-002',
            'full_name': 'Pending NFC Student',
            'email': 'pending.nfc@example.com',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        }, format='json')
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

        response = self.client.post('/api/cabinet/enrollment/register/', {
            'token': 'existing-account-token',
            'student_id': 'EXISTING-001',
            'full_name': 'Existing Account Student',
            'email': 'existing.account@example.com',
            'password': 'new-password-123',
            'confirm_password': 'new-password-123',
        }, format='json')
        self.assertEqual(response.status_code, 409, response.json())
