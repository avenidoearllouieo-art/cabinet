from tempfile import TemporaryDirectory
from pathlib import Path
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from datetime import timedelta

from django.core.files.storage import FileSystemStorage
from django.core.management import call_command
from django.db.models import FileField
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Activity,
    ActivityAttachment,
    ActivityDiscussion,
    ActivityDiscussionAttachment,
    MultipartUploadSession,
    Section,
    Submission,
    SubmissionAttachment,
    TemporaryUpload,
    User,
)
from .views import open_storage_object


class LegacyMediaMigrationCommandTests(TestCase):
    def test_dry_run_and_copy_preserve_source_and_storage_key(self):
        with TemporaryDirectory() as source_root, TemporaryDirectory() as target_root:
            source_path = Path(source_root) / 'activity_attachments' / 'brief.pdf'
            source_path.parent.mkdir(parents=True)
            source_path.write_bytes(b'%PDF-1.4 legacy bytes')

            field = FileField(upload_to='activity_attachments/')
            field.name = 'file'
            field.storage = FileSystemStorage(location=target_root)
            record = SimpleNamespace(pk=17, file=SimpleNamespace(name='activity_attachments/brief.pdf'))
            queryset = Mock()
            queryset.iterator.side_effect = lambda: iter([record])
            manager = Mock()
            manager.only.return_value = queryset
            model = SimpleNamespace(
                _meta=SimpleNamespace(get_fields=lambda: [field], label='api.ActivityAttachment'),
                objects=manager,
            )
            output = StringIO()

            with patch('api.management.commands.migrate_legacy_media.apps.get_models', return_value=[model]):
                call_command(
                    'migrate_legacy_media',
                    legacy_media_root=source_root,
                    dry_run=True,
                    stdout=output,
                )
                self.assertFalse(Path(target_root, 'activity_attachments', 'brief.pdf').exists())
                call_command(
                    'migrate_legacy_media',
                    legacy_media_root=source_root,
                    stdout=output,
                )

            target_path = Path(target_root) / 'activity_attachments' / 'brief.pdf'
            self.assertTrue(source_path.exists())
            self.assertEqual(target_path.read_bytes(), b'%PDF-1.4 legacy bytes')
            self.assertIn('Would copy 1 file(s)', output.getvalue())
            self.assertIn('Copied 1 file(s)', output.getvalue())
            self.assertEqual(record.file.name, 'activity_attachments/brief.pdf')


@override_settings(
    MEDIA_STORAGE_BACKEND='s3',
    AWS_STORAGE_BUCKET_NAME='taptrack-files',
    AWS_ACCESS_KEY_ID='test-access-key',
    AWS_SECRET_ACCESS_KEY='test-secret-key',
    AWS_S3_ENDPOINT_URL='https://t3.storage.dev',
    AWS_S3_REGION_NAME='auto',
    TAPTRACK_PRESIGNED_PART_URL_TTL=900,
)
class StudentMultipartUploadAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.instructor = User.objects.create_user(
            username='multipart-instructor',
            email='multipart-instructor@example.test',
            password='Secret-123',
            role=User.RoleChoices.INSTRUCTOR,
            instructor_id='MULTIPART-INSTRUCTOR',
        )
        self.section = Section.objects.create(section_name='Multipart Section', instructor=self.instructor)
        self.student = User.objects.create_user(
            username='multipart-student',
            email='multipart-student@example.test',
            password='Secret-123',
            role=User.RoleChoices.STUDENT,
            student_id='MULTIPART-STUDENT',
            section=self.section,
        )
        self.other_student = User.objects.create_user(
            username='multipart-other-student',
            email='multipart-other-student@example.test',
            password='Secret-123',
            role=User.RoleChoices.STUDENT,
            student_id='MULTIPART-OTHER-STUDENT',
        )
        self.activity = Activity.objects.create(
            title='Multipart video activity',
            section=self.section,
            created_by=self.instructor,
            status=Activity.StatusChoices.PUBLISHED,
        )

    def start_upload(self, file_size=10 * 1024 * 1024, filename='demo.mp4'):
        self.client.force_authenticate(user=self.student)
        return self.client.post('/api/student/multipart-uploads/', {
            'activity': self.activity.pk,
            'filename': filename,
            'file_size': file_size,
        }, format='json')

    @patch('api.tigris_uploads.get_tigris_client')
    def test_start_part_url_and_other_user_cannot_access_session(self, get_client):
        s3 = get_client.return_value
        s3.create_multipart_upload.return_value = {'UploadId': 'tigris-upload-1'}
        s3.generate_presigned_url.return_value = 'https://taptrack-files.t3.storage.dev/signed-part'

        started = self.start_upload(file_size=600 * 1024 * 1024)

        self.assertEqual(started.status_code, 201, started.json())
        session = MultipartUploadSession.objects.get(pk=started.json()['upload_id'])
        self.assertEqual(session.user_id, self.student.pk)
        self.assertEqual(session.activity_id, self.activity.pk)
        self.assertTrue(session.object_key.startswith(f'submissions/videos/{self.student.pk}/'))
        self.assertEqual(session.total_parts, 19)
        self.assertEqual(s3.create_multipart_upload.call_args.kwargs['Bucket'], 'taptrack-files')
        self.assertEqual(s3.create_multipart_upload.call_args.kwargs['Metadata']['owner-id'], str(self.student.pk))

        part = self.client.post(f'/api/student/multipart-uploads/{session.pk}/parts/1/', {}, format='json')
        self.assertEqual(part.status_code, 200, part.json())
        self.assertEqual(part.json()['url'], 'https://taptrack-files.t3.storage.dev/signed-part')
        s3.generate_presigned_url.assert_called_once()
        self.assertEqual(s3.generate_presigned_url.call_args.kwargs['ExpiresIn'], 900)

        self.client.force_authenticate(user=self.other_student)
        unauthorized = self.client.post(f'/api/student/multipart-uploads/{session.pk}/parts/1/', {}, format='json')
        self.assertEqual(unauthorized.status_code, 404)
        self.assertEqual(s3.generate_presigned_url.call_count, 1)

    @patch('api.tigris_uploads.get_tigris_client')
    def test_video_above_configured_limit_is_rejected_before_provider_request(self, get_client):
        response = self.start_upload(file_size=5 * 1024 ** 3 + 1)

        self.assertEqual(response.status_code, 400, response.json())
        get_client.return_value.create_multipart_upload.assert_not_called()

    @patch('api.tigris_uploads.get_tigris_client')
    def test_completion_verifies_parts_metadata_size_and_video_signature_before_linking(self, get_client):
        s3 = get_client.return_value
        s3.create_multipart_upload.return_value = {'UploadId': 'tigris-upload-2'}
        s3.list_parts.return_value = {'Parts': [{'PartNumber': 1, 'ETag': '"part-etag"', 'Size': 10 * 1024 * 1024}]}
        s3.head_object.return_value = {
            'ContentLength': 10 * 1024 * 1024,
            'ContentType': 'video/mp4',
            'Metadata': {
                'owner-id': str(self.student.pk),
                'activity-id': str(self.activity.pk),
                'upload-session-id': '',
            },
        }
        body = Mock()
        body.read.return_value = b'\x00\x00\x00\x18ftypisom-video-header'
        s3.get_object.return_value = {'Body': body}
        self.client.force_authenticate(user=self.student)

        started = self.client.post('/api/student/multipart-uploads/', {
            'activity': self.activity.pk,
            'filename': 'defense-video.mp4',
            'file_size': 10 * 1024 * 1024,
        }, format='json')
        session = MultipartUploadSession.objects.get(pk=started.json()['upload_id'])
        s3.head_object.return_value['Metadata']['upload-session-id'] = session.pk.hex

        complete = self.client.post(f'/api/student/multipart-uploads/{session.pk}/complete/', {
            'parts': [{'part_number': 1, 'etag': 'part-etag'}],
        }, format='json')

        self.assertEqual(complete.status_code, 201, complete.json())
        upload = TemporaryUpload.objects.get(pk=complete.json()['temp_upload_id'])
        self.assertEqual(upload.user_id, self.student.pk)
        self.assertEqual(upload.activity_id, self.activity.pk)
        self.assertEqual(upload.original_filename, 'defense-video.mp4')
        self.assertEqual(upload.file.name, session.object_key)
        self.assertEqual(upload.file_size, 10 * 1024 * 1024)
        session.refresh_from_db()
        self.assertEqual(session.status, MultipartUploadSession.StatusChoices.COMPLETED)
        s3.complete_multipart_upload.assert_called_once()

    @patch('api.tigris_uploads.get_tigris_client')
    def test_abort_releases_provider_upload_and_is_scoped_to_owner(self, get_client):
        s3 = get_client.return_value
        s3.create_multipart_upload.return_value = {'UploadId': 'tigris-upload-3'}
        started = self.start_upload()
        session = MultipartUploadSession.objects.get(pk=started.json()['upload_id'])

        self.client.force_authenticate(user=self.other_student)
        unauthorized = self.client.post(f'/api/student/multipart-uploads/{session.pk}/abort/', {}, format='json')
        self.assertEqual(unauthorized.status_code, 404)
        s3.abort_multipart_upload.assert_not_called()

        self.client.force_authenticate(user=self.student)
        aborted = self.client.post(f'/api/student/multipart-uploads/{session.pk}/abort/', {}, format='json')
        self.assertEqual(aborted.status_code, 204)
        s3.abort_multipart_upload.assert_called_once()
        session.refresh_from_db()
        self.assertEqual(session.status, MultipartUploadSession.StatusChoices.ABORTED)

    @patch('api.management.commands.cleanup_tigris_multipart_uploads.get_tigris_client')
    def test_cleanup_aborts_expired_sessions_and_old_orphaned_provider_uploads(self, get_client):
        s3 = get_client.return_value
        s3.list_multipart_uploads.return_value = {
            'Uploads': [{
                'Key': 'submissions/videos/unknown/orphan.mp4',
                'UploadId': 'orphan-id',
                'Initiated': timezone.now() - timedelta(days=2),
            }],
            'IsTruncated': False,
        }
        session = MultipartUploadSession.objects.create(
            user=self.student,
            activity=self.activity,
            object_key=f'submissions/videos/{self.student.pk}/expired.mp4',
            upload_id='expired-id',
            original_filename='expired.mp4',
            content_type='video/mp4',
            file_size=10 * 1024 * 1024,
            part_size=10 * 1024 * 1024,
            total_parts=1,
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        output = StringIO()
        call_command('cleanup_tigris_multipart_uploads', stdout=output)

        session.refresh_from_db()
        self.assertEqual(session.status, MultipartUploadSession.StatusChoices.ABORTED)
        self.assertEqual(s3.abort_multipart_upload.call_count, 2)
        self.assertIn('Aborted 2 multipart upload(s)', output.getvalue())

    @patch('api.tigris_uploads.get_tigris_client')
    def test_invalid_completed_object_is_deleted_and_never_linked(self, get_client):
        s3 = get_client.return_value
        s3.create_multipart_upload.return_value = {'UploadId': 'tigris-upload-4'}
        s3.list_parts.return_value = {'Parts': [{'PartNumber': 1, 'ETag': 'etag', 'Size': 10 * 1024 * 1024}]}
        s3.head_object.return_value = {
            'ContentLength': 10 * 1024 * 1024,
            'ContentType': 'video/mp4',
            'Metadata': {'owner-id': 'wrong-owner', 'activity-id': str(self.activity.pk), 'upload-session-id': ''},
        }
        self.client.force_authenticate(user=self.student)
        started = self.client.post('/api/student/multipart-uploads/', {
            'activity': self.activity.pk,
            'filename': 'bad-video.mp4',
            'file_size': 10 * 1024 * 1024,
        }, format='json')
        session = MultipartUploadSession.objects.get(pk=started.json()['upload_id'])
        s3.head_object.return_value['Metadata']['upload-session-id'] = session.pk.hex

        response = self.client.post(f'/api/student/multipart-uploads/{session.pk}/complete/', {
            'parts': [{'part_number': 1, 'etag': 'etag'}],
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(TemporaryUpload.objects.filter(user=self.student, activity=self.activity).exists())
        self.assertEqual(session.__class__.objects.get(pk=session.pk).status, MultipartUploadSession.StatusChoices.FAILED)
        s3.delete_object.assert_called_once_with(Bucket='taptrack-files', Key=session.object_key)
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
            status=Activity.StatusChoices.PUBLISHED,
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

    def test_django_admin_renders_activity_and_submission_file_controls(self):
        self.client.force_login(self.admin)

        activity_response = self.client.get(reverse('admin:api_activity_change', args=[self.activity.pk]))
        submission_response = self.client.get(reverse('admin:api_submission_change', args=[self.own_submission.pk]))

        self.assertEqual(activity_response.status_code, 200)
        self.assertContains(activity_response, 'brief.pdf')
        self.assertContains(activity_response, self.activity_attachment.file.name)
        self.assertEqual(submission_response.status_code, 200)
        self.assertContains(submission_response, self.own_submission.file.name)
        self.assertContains(submission_response, self.own_submission_attachment.file.name)

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

    def test_s3_range_reads_request_only_the_requested_object_bytes(self):
        body = Mock()
        client = Mock()
        client.get_object.return_value = {'Body': body}
        storage = SimpleNamespace(
            bucket_name='private-taptrack-media',
            _normalize_name=lambda name: name,
            connection=SimpleNamespace(meta=SimpleNamespace(client=client)),
        )
        file_field = SimpleNamespace(name='activity_attachments/demo.mp4', storage=storage)

        result = open_storage_object(file_field, (1024, 2047))

        self.assertIs(result, body)
        client.get_object.assert_called_once_with(
            Bucket='private-taptrack-media',
            Key='activity_attachments/demo.mp4',
            Range='bytes=1024-2047',
        )

    def test_uploaded_mp4_is_stored_and_retrievable_through_authorized_preview_and_download(self):
        self.client.force_authenticate(user=self.instructor)
        video_bytes = b'\x00\x00\x00\x18ftypisomuploaded-video-bytes'
        uploaded = SimpleUploadedFile('Screen Recording.mp4', video_bytes, content_type='video/mp4')
        response = self.client.post('/api/activities/', {
            'title': 'Uploaded video activity',
            'assigned_sections': [self.section.pk],
            'status': Activity.StatusChoices.PUBLISHED,
            'attachments': [uploaded],
        }, format='multipart')

        self.assertEqual(response.status_code, 201, response.json())
        attachment_payload = response.json()['attachments'][0]
        self.assertEqual(attachment_payload['filename'], 'Screen Recording.mp4')
        self.assertEqual(attachment_payload['content_type'], 'video/mp4')
        self.assertEqual(attachment_payload['preview_kind'], 'activity')
        attachment = ActivityAttachment.objects.get(pk=attachment_payload['id'])
        self.assertTrue(attachment.file.storage.exists(attachment.file.name))
        self.assertTrue(attachment.file.name.startswith('activities/attachments/'))
        self.assertEqual(attachment.original_filename, 'Screen Recording.mp4')

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
        self.assertIn('file is missing from storage', response.json()['detail'])

    def test_https_preview_cookie_allows_cross_origin_media_requests(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/file-previews/activity/{self.activity_attachment.pk}/authorize/',
            secure=True,
        )

        self.assertEqual(response.status_code, 200, response.json())
        cookie = response.cookies[
            f'taptrack_file_preview_activity_{self.activity_attachment.pk}'
        ]
        self.assertEqual(cookie['samesite'], 'None')
        self.assertTrue(cookie['secure'])

    @override_settings(AWS_QUERYSTRING_EXPIRE=600)
    @patch('api.views.get_academic_attachment')
    def test_tigris_preview_and_download_return_short_lived_private_urls(self, get_attachment):
        client = Mock()
        client.generate_presigned_url.side_effect = [
            'https://taptrack-files.t3.storage.dev/private-key?signature=preview',
            'https://taptrack-files.t3.storage.dev/private-key?signature=download',
        ]
        storage = SimpleNamespace(
            bucket_name='taptrack-files',
            _normalize_name=lambda name: name,
            connection=SimpleNamespace(meta=SimpleNamespace(client=client)),
            exists=Mock(return_value=True),
        )
        stored_file = SimpleNamespace(name='activities/attachments/private.pdf', storage=storage, size=17)
        record = SimpleNamespace(
            original_filename='defense brief.pdf',
            file_size=17,
            content_type='application/pdf',
        )
        get_attachment.return_value = (record, stored_file, self.activity, None)
        self.client.force_authenticate(user=self.student)

        response = self.client.post(f'/api/file-previews/activity/{self.activity_attachment.pk}/authorize/')

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['content_url'], 'https://taptrack-files.t3.storage.dev/private-key?signature=preview')
        self.assertEqual(response.json()['download_url'], 'https://taptrack-files.t3.storage.dev/private-key?signature=download')
        self.assertNotIn(f'taptrack_file_preview_activity_{self.activity_attachment.pk}', response.cookies)
        calls = client.generate_presigned_url.call_args_list
        self.assertEqual([call.args[0] for call in calls], ['get_object', 'get_object'])
        self.assertTrue(all(call.kwargs['ExpiresIn'] == 600 for call in calls))
        self.assertIn('inline;', calls[0].kwargs['Params']['ResponseContentDisposition'])
        self.assertIn('attachment;', calls[1].kwargs['Params']['ResponseContentDisposition'])

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