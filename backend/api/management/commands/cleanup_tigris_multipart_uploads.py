from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from api.models import MultipartUploadSession
from api.tigris_uploads import get_tigris_client


class Command(BaseCommand):
    help = 'Abort expired tracked and orphaned Tigris multipart uploads.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--orphan-age-hours', type=int, default=24)

    def handle(self, *args, **options):
        if settings.MEDIA_STORAGE_BACKEND != 's3':
            raise CommandError('Tigris multipart cleanup requires Tigris media storage.')
        age_hours = options['orphan_age_hours']
        if age_hours < 1:
            raise CommandError('--orphan-age-hours must be at least 1.')

        client = get_tigris_client()
        bucket = settings.AWS_STORAGE_BUCKET_NAME
        now = timezone.now()
        expired_sessions = MultipartUploadSession.objects.filter(
            status=MultipartUploadSession.StatusChoices.INITIATED,
            expires_at__lte=now,
        )
        aborted = 0
        failed = 0
        for session in expired_sessions.iterator():
            if options['dry_run']:
                self.stdout.write(f'Would abort expired session {session.pk}.')
                continue
            try:
                client.abort_multipart_upload(
                    Bucket=bucket,
                    Key=session.object_key,
                    UploadId=session.upload_id,
                )
                session.status = MultipartUploadSession.StatusChoices.ABORTED
                session.save(update_fields=['status'])
                aborted += 1
            except Exception:
                self.stderr.write(f'Failed to abort expired session {session.pk}.')
                failed += 1

        cutoff = now - timedelta(hours=age_hours)
        tracked = set(MultipartUploadSession.objects.values_list('object_key', 'upload_id'))
        marker_key = None
        marker_upload_id = None
        while True:
            params = {'Bucket': bucket, 'Prefix': 'submissions/videos/'}
            if marker_key:
                params['KeyMarker'] = marker_key
            if marker_upload_id:
                params['UploadIdMarker'] = marker_upload_id
            page = client.list_multipart_uploads(**params)
            for upload in page.get('Uploads', []):
                upload_key = upload['Key']
                upload_id = upload['UploadId']
                if (upload_key, upload_id) in tracked or upload.get('Initiated') is None or upload['Initiated'] > cutoff:
                    continue
                if options['dry_run']:
                    self.stdout.write(f'Would abort orphaned object upload {upload_key}.')
                    continue
                try:
                    client.abort_multipart_upload(Bucket=bucket, Key=upload_key, UploadId=upload_id)
                    aborted += 1
                except Exception:
                    self.stderr.write(f'Failed to abort orphaned object upload {upload_key}.')
                    failed += 1
            if not page.get('IsTruncated'):
                break
            marker_key = page.get('NextKeyMarker')
            marker_upload_id = page.get('NextUploadIdMarker')
            if not marker_key:
                break

        mode = 'Would abort' if options['dry_run'] else 'Aborted'
        self.stdout.write(f'{mode} {aborted} multipart upload(s); {failed} failure(s).')
        if failed:
            raise CommandError(f'{failed} multipart upload(s) could not be aborted.')
