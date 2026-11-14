from tempfile import TemporaryDirectory

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import (
    Activity,
    ActivityAttachment,
    ActivityDiscussion,
    ActivityDiscussionAttachment,
    Section,
    Submission,
    SubmissionAttachment,
    User,
)
from django.core.files.uploadedfile import SimpleUploadedFile


class AcademicFilePreviewAPITests(TestCase):
    def setUp(self):
        self.media_directory = TemporaryDirectory()
        self.addCleanup(self.media_directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=self.media_directory.name))
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='file-preview-admin',
            email='file-preview-admin@example.com',
            password='TestAdminPassword-123',
            nfc_uid='FILE-PREVIEW-ADMIN-UID',
        )
        self.instructor = User.objects.create_user(
            username='file-preview-instructor',
            email='file-preview-instructor@example.com',
            password='TestInstructorPassword-123',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='FILE-PREVIEW-INSTRUCTOR',
            nfc_uid='FILE-PREVIEW-INSTRUCTOR-UID',
        )
        self.other_instructor = User.objects.create_user(
            username='file-preview-other-instructor',
            email='file-preview-other-instructor@example.com',
            password='TestInstructorPassword-123',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='FILE-PREVIEW-OTHER-INSTRUCTOR',
            nfc_uid='FILE-PREVIEW-OTHER-UID',
        )
        self.section = Section.objects.create(section_name='File Preview Section', instructor=self.instructor)
        self.other_section = Section.objects.create(section_name='Other File Preview Section', instructor=self.other_instructor)
        self.student = User.objects.create_user(
            username='file-preview-student',
            email='file-preview-student@example.com',
            password='TestStudentPassword-123',
            role=User.RoleChoices.STUDENT,
            student_id='FILE-PREVIEW-STUDENT',
            section=self.section,
            nfc_uid='FILE-PREVIEW-STUDENT-UID',
        )
        self.other_student = User.objects.create_user(
            username='file-preview-other-student',
            email='file-preview-other-student@example.com',
            password='TestStudentPassword-123',
            role=User.RoleChoices.STUDENT,
            student_id='FILE-PREVIEW-OTHER-STUDENT',
            section=self.other_section,
            nfc_uid='FILE-PREVIEW-OTHER-STUDENT-UID',
        )
        self.activity = Activity.objects.create(
            title='File Preview Activity',
            created_by=self.instructor,
            section=self.section,
        )
        self.activity_attachment = ActivityAttachment.objects.create(
            activity=self.activity,
            file=SimpleUploadedFile('brief.pdf', b'%PDF-preview-data', content_type='application/pdf'),
            original_filename='brief.pdf',
            file_size=17,
        )
        self.video_attachment = ActivityAttachment.objects.create(
            activity=self.activity,
            file=SimpleUploadedFile('demo.mp4', b'0123456789abcdef', content_type='video/mp4'),
            original_filename='demo.mp4',
        )
        self.unrelated_activity = Activity.objects.create(
            title='Other Activity',
            created_by=self.other_instructor,
            section=self.other_section,
        )
        self.own_submission = Submission.objects.create(
            activity=self.activity,
            student=self.student,
            file=SimpleUploadedFile('student-work.png', b'PNG-preview', content_type='image/png'),
        )
        self.own_submission_attachment = SubmissionAttachment.objects.create(
            submission=self.own_submission,
            file=SimpleUploadedFile('student-work.png', b'PNG-preview', content_type='image/png'),
        )
        self.other_submission = Submission.objects.create(
            activity=self.unrelated_activity,
            student=self.other_student,
            file=SimpleUploadedFile('private-work.txt', b'private', content_type='text/plain'),
        )
        self.other_submission_attachment = SubmissionAttachment.objects.create(
            submission=self.other_submission,
            file=SimpleUploadedFile('private-work.txt', b'private', content_type='text/plain'),
        )
        self.discussion = ActivityDiscussion.objects.create(
            activity=self.activity,
            sender=self.instructor,
            sender_role=User.RoleChoices.INSTRUCTOR,
            message='Review this attached file.',
        )
        self.discussion_attachment = ActivityDiscussionAttachment.objects.create(
            discussion=self.discussion,
            file=SimpleUploadedFile('discussion.pdf', b'%PDF-discussion', content_type='application/pdf'),
            original_filename='discussion.pdf',
        )

    def authorize(self, kind, attachment_id, user):
        self.client.force_authenticate(user=user)
        return self.client.post(f'/api/file-previews/{kind}/{attachment_id}/authorize/')

    @staticmethod
    def consume_response(response):
        if response.streaming:
            content = b''.join(response.streaming_content)
        else:
            content = response.content
        response.close()
        return content

    def test_student_can_preview_assigned_activity_and_discussion_files(self):
        activity_access = self.authorize('activity', self.activity_attachment.pk, self.student)
        self.assertEqual(activity_access.status_code, 200, activity_access.json())
        self.assertEqual(activity_access.json()['preview_type'], 'pdf')
        self.assertEqual(activity_access.json()['filename'], 'brief.pdf')
        content = self.client.get(activity_access.json()['content_url'])
        self.assertEqual(content.status_code, 200)
        self.assertIn(b'%PDF-preview-data', self.consume_response(content))
        self.assertEqual(content['Content-Type'], 'application/pdf')
        self.assertIn('inline', content['Content-Disposition'])
        self.assertEqual(content['X-Content-Type-Options'], 'nosniff')
        self.assertIn('no-store', content['Cache-Control'])

        discussion_access = self.authorize('discussion', self.discussion_attachment.pk, self.student)
        self.assertEqual(discussion_access.status_code, 200, discussion_access.json())
        discussion_content = self.client.get(discussion_access.json()['content_url'])
        self.assertEqual(discussion_content.status_code, 200)
        self.assertIn(b'%PDF-discussion', self.consume_response(discussion_content))

    def test_student_cannot_preview_another_students_submission(self):
        response = self.authorize('submission', self.other_submission_attachment.pk, self.student)
        self.assertEqual(response.status_code, 404)

    def test_instructor_and_admin_can_preview_authorized_academic_files(self):
        instructor_access = self.authorize('submission', self.own_submission_attachment.pk, self.instructor)
        self.assertEqual(instructor_access.status_code, 200, instructor_access.json())
        instructor_content = self.client.get(instructor_access.json()['content_url'])
        self.assertEqual(instructor_content.status_code, 200)
        self.assertIn(b'PNG-preview', self.consume_response(instructor_content))
        self.assertTrue(instructor_access.json()['preview_supported'])

        self.client.force_authenticate(user=self.other_instructor)
        self.assertEqual(
            self.client.post(f'/api/file-previews/activity/{self.activity_attachment.pk}/authorize/').status_code,
            404,
        )

        admin_access = self.authorize('activity', self.activity_attachment.pk, self.admin)
        self.assertEqual(admin_access.status_code, 200, admin_access.json())

    def test_range_requests_stream_video_and_download_is_explicit(self):
        video_access = self.authorize('activity', self.video_attachment.pk, self.student)
        self.assertEqual(video_access.status_code, 200, video_access.json())
        self.assertEqual(video_access.json()['preview_type'], 'video')

        partial = self.client.get(video_access.json()['content_url'], HTTP_RANGE='bytes=2-5')
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(self.consume_response(partial), b'2345')
        self.assertEqual(partial['Content-Range'], 'bytes 2-5/16')
        self.assertEqual(partial['Accept-Ranges'], 'bytes')

        download = self.client.get(video_access.json()['download_url'])
        self.assertEqual(download.status_code, 200)
        self.assertIn('attachment', download['Content-Disposition'])
        self.assertEqual(self.consume_response(download), b'0123456789abcdef')

    def test_uploaded_mp4_is_stored_and_retrievable_through_authorized_preview_and_download(self):
        self.client.force_authenticate(user=self.instructor)
        video_bytes = b'\x00\x00\x00\x18ftypisomuploaded-video-bytes'
        uploaded = SimpleUploadedFile('Screen Recording.mp4', video_bytes, content_type='video/mp4')
        response = self.client.post('/api/activities/', {
            'title': 'Uploaded video activity',
            'assigned_sections': [self.section.pk],
            'attachments': [uploaded],
        }, format='multipart')

        self.assertEqual(response.status_code, 201, response.json())
        attachment_payload = response.json()['attachments'][0]
        self.assertEqual(attachment_payload['filename'], 'Screen Recording.mp4')
        self.assertEqual(attachment_payload['content_type'], 'video/mp4')
        self.assertEqual(attachment_payload['preview_kind'], 'activity')
        attachment = ActivityAttachment.objects.get(pk=attachment_payload['id'])
        self.assertTrue(attachment.file.storage.exists(attachment.file.name))
        self.assertEqual(attachment.file.name.split('/')[0], 'activity_attachments')

        access = self.authorize('activity', attachment.pk, self.student)
        self.assertEqual(access.status_code, 200, access.json())
        self.assertEqual(access.json()['preview_type'], 'video')
        content = self.client.get(access.json()['content_url'])
        self.assertEqual(content.status_code, 200)
        self.assertEqual(content['Content-Type'], 'video/mp4')
        self.assertEqual(self.consume_response(content), video_bytes)
        download = self.client.get(access.json()['download_url'])
        self.assertEqual(download.status_code, 200)
        self.assertIn('filename="Screen Recording.mp4"', download['Content-Disposition'])
        self.assertEqual(self.consume_response(download), video_bytes)

    def test_authorize_reports_file_unavailable_when_storage_object_is_missing(self):
        stored_name = self.video_attachment.file.name
        self.video_attachment.file.storage.delete(stored_name)

        self.client.force_authenticate(user=self.instructor)
        activity_response = self.client.get(f'/api/activities/{self.activity.pk}/')
        self.assertEqual(activity_response.status_code, 200, activity_response.json())
        self.assertEqual(activity_response.json()['attachments'][0]['size'], None)

        response = self.authorize('activity', self.video_attachment.pk, self.student)

        self.assertEqual(response.status_code, 404)

    def test_missing_cookie_and_direct_media_path_do_not_expose_files(self):
        content_url = reverse('academic_file_preview_content', args=['activity', self.activity_attachment.pk])
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(content_url).status_code, 404)
        self.assertEqual(self.client.get(f'/media/{self.activity_attachment.file.name}').status_code, 404)

    def test_unsupported_office_file_reports_download_only(self):
        office_attachment = ActivityAttachment.objects.create(
            activity=self.activity,
            file=SimpleUploadedFile('slides.pptx', b'office-bytes'),
            original_filename='slides.pptx',
        )
        response = self.authorize('activity', office_attachment.pk, self.student)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertFalse(response.json()['preview_supported'])
        content = self.client.get(response.json()['content_url'])
        self.assertEqual(content.status_code, 200)
        self.assertIn('attachment', content['Content-Disposition'])
        self.assertEqual(self.consume_response(content), b'office-bytes')