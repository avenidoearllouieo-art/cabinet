from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .models import AccessLog, Notification, Section, User, Activity, ActivityAttachment, Submission


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
        self.section_a = Section.objects.create(section_name='API Section A', section_code='API-A')
        self.section_b = Section.objects.create(section_name='API Section B', section_code='API-B')
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
        self.section_a = Section.objects.create(section_name='Section A', section_code='SEC-A', instructor=self.instructor)
        self.section_b = Section.objects.create(section_name='Section B', section_code='SEC-B', instructor=self.instructor)
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
        self.section = Section.objects.create(section_name='Section Grade', section_code='SEC-G', instructor=self.instructor)
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
        self.assertIn('section_code', SectionAdmin.search_fields)

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
