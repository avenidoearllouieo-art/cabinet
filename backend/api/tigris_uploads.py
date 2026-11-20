import math
import os
import uuid
from datetime import timedelta
from functools import lru_cache
from io import BytesIO

import boto3
from botocore.config import Config
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.utils import timezone

from .file_uploads import FILE_TYPES, _content_matches
from .models import MultipartUploadSession, TemporaryUpload


VIDEO_TYPES = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
}


@lru_cache(maxsize=1)
def get_tigris_client():
    if settings.MEDIA_STORAGE_BACKEND != 's3':
        raise ImproperlyConfigured('Tigris multipart uploads require Tigris media storage.')
    return boto3.client(
        's3',
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        region_name=settings.AWS_S3_REGION_NAME,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(
            signature_version='s3v4',
            s3={'addressing_style': settings.AWS_S3_ADDRESSING_STYLE},
            retries={'max_attempts': 3, 'mode': 'standard'},
        ),
    )


def clean_original_filename(filename):
    filename = str(filename or '').replace('\\', '/').rsplit('/', 1)[-1]
    filename = ''.join(char for char in filename if char.isprintable() and char not in {'\r', '\n', '\x00'})
    filename = filename.strip(' .')[:255]
    return filename or 'student-video.mp4'


def create_multipart_session(user, activity, original_filename, file_size):
    filename = clean_original_filename(original_filename)
    extension = os.path.splitext(filename)[1].lower()
    if extension not in VIDEO_TYPES:
        raise ValueError('Direct multipart uploads currently support MP4, MOV, and WebM videos only.')
    if extension not in FILE_TYPES:
        raise ValueError('This video type is not supported.')
    if file_size <= 0 or file_size > settings.TAPTRACK_MAX_STUDENT_VIDEO_BYTES:
        maximum_gb = settings.TAPTRACK_MAX_STUDENT_VIDEO_BYTES / (1024 ** 3)
        raise ValueError(f'Video files must be larger than zero and no more than {maximum_gb:g} GB.')

    part_size = settings.TAPTRACK_MULTIPART_PART_SIZE
    total_parts = math.ceil(file_size / part_size)
    if total_parts > 10_000:
        raise ValueError('This video requires too many upload parts.')

    session_id = uuid.uuid4()
    object_key = f'submissions/videos/{user.pk}/{uuid.uuid4().hex}{extension}'
    content_type = VIDEO_TYPES[extension]
    client = get_tigris_client()
    created = client.create_multipart_upload(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=object_key,
        ContentType=content_type,
        CacheControl='private, no-store',
        Metadata={
            'owner-id': str(user.pk),
            'activity-id': str(activity.pk),
            'upload-session-id': session_id.hex,
        },
    )
    expires_at = timezone.now() + timedelta(seconds=settings.TAPTRACK_MULTIPART_SESSION_TTL)
    try:
        session = MultipartUploadSession.objects.create(
            id=session_id,
            user=user,
            activity=activity,
            object_key=object_key,
            upload_id=created['UploadId'],
            original_filename=filename,
            content_type=content_type,
            file_size=file_size,
            part_size=part_size,
            total_parts=total_parts,
            expires_at=expires_at,
        )
    except Exception:
        client.abort_multipart_upload(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME,
            Key=object_key,
            UploadId=created['UploadId'],
        )
        raise
    return session


def presign_upload_part(session, part_number):
    if not 1 <= part_number <= session.total_parts:
        raise ValueError('Upload part number is outside this session.')
    return get_tigris_client().generate_presigned_url(
        'upload_part',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': session.object_key,
            'UploadId': session.upload_id,
            'PartNumber': part_number,
        },
        ExpiresIn=settings.TAPTRACK_PRESIGNED_PART_URL_TTL,
        HttpMethod='PUT',
    )


def _get_uploaded_parts(session):
    result = get_tigris_client().list_parts(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=session.object_key,
        UploadId=session.upload_id,
        MaxParts=1000,
    )
    return sorted(result.get('Parts', []), key=lambda part: part['PartNumber'])


def _validate_parts(session, reported_parts):
    if not isinstance(reported_parts, list) or len(reported_parts) != session.total_parts:
        raise ValueError('Upload is incomplete. Upload every video part before completing it.')
    actual_parts = _get_uploaded_parts(session)
    if len(actual_parts) != session.total_parts:
        raise ValueError('Tigris has not received every required video part.')

    expected_bytes = session.file_size
    normalized_client_parts = {}
    for item in reported_parts:
        try:
            part_number = int(item['part_number'])
            etag = str(item['etag']).strip().strip('"')
        except (KeyError, TypeError, ValueError):
            raise ValueError('Each completed part must include its part number and ETag.')
        if part_number in normalized_client_parts or not etag:
            raise ValueError('Upload part metadata is invalid.')
        normalized_client_parts[part_number] = etag

    if set(normalized_client_parts) != set(range(1, session.total_parts + 1)):
        raise ValueError('Upload part numbers must be complete and consecutive.')

    completed_parts = []
    for actual in actual_parts:
        number = actual['PartNumber']
        if normalized_client_parts[number] != str(actual['ETag']).strip('"'):
            raise ValueError('An uploaded part changed or its ETag does not match Tigris.')
        required_size = min(session.part_size, expected_bytes - (number - 1) * session.part_size)
        if int(actual['Size']) != required_size:
            raise ValueError('An uploaded part has an unexpected size.')
        completed_parts.append({'PartNumber': number, 'ETag': actual['ETag']})
    return completed_parts


def _validate_completed_object(session):
    client = get_tigris_client()
    head = client.head_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=session.object_key)
    metadata = {key.lower(): value for key, value in (head.get('Metadata') or {}).items()}
    if int(head.get('ContentLength', -1)) != session.file_size:
        raise ValueError('The completed object size does not match the authorized upload size.')
    if head.get('ContentType') != session.content_type:
        raise ValueError('The completed object content type does not match the authorized video type.')
    if metadata.get('owner-id') != str(session.user_id):
        raise ValueError('The completed object owner does not match this upload session.')
    if metadata.get('activity-id') != str(session.activity_id):
        raise ValueError('The completed object activity does not match this upload session.')
    if metadata.get('upload-session-id') != session.pk.hex:
        raise ValueError('The completed object does not match this upload session.')

    sample = client.get_object(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=session.object_key,
        Range='bytes=0-31',
    )
    try:
        header = sample['Body'].read(32)
    finally:
        sample['Body'].close()
    extension = os.path.splitext(session.original_filename)[1].lower()
    if not _content_matches(BytesIO(header), extension):
        raise ValueError('The uploaded video contents do not match the declared format.')
    return head


def complete_multipart_session(session, reported_parts):
    if session.status == MultipartUploadSession.StatusChoices.COMPLETED and session.temporary_upload_id:
        return session.temporary_upload
    if session.status != MultipartUploadSession.StatusChoices.INITIATED:
        raise ValueError('This upload session is no longer active.')
    if session.expires_at <= timezone.now():
        raise ValueError('This upload session has expired. Start a new upload.')

    client = get_tigris_client()
    already_completed = False
    try:
        completed_parts = _validate_parts(session, reported_parts)
    except Exception as parts_error:
        try:
            _validate_completed_object(session)
            already_completed = True
        except Exception:
            raise parts_error
    try:
        if not already_completed:
            try:
                client.complete_multipart_upload(
                    Bucket=settings.AWS_STORAGE_BUCKET_NAME,
                    Key=session.object_key,
                    UploadId=session.upload_id,
                    MultipartUpload={'Parts': completed_parts},
                )
            except Exception:
                _validate_completed_object(session)
        _validate_completed_object(session)
        with transaction.atomic():
            temporary_upload = TemporaryUpload(
                user=session.user,
                activity=session.activity,
                original_filename=session.original_filename,
                file_size=session.file_size,
                content_type=session.content_type,
            )
            temporary_upload.file.name = session.object_key
            temporary_upload.save()
            session.temporary_upload = temporary_upload
            session.status = MultipartUploadSession.StatusChoices.COMPLETED
            session.completed_at = timezone.now()
            session.save(update_fields=['temporary_upload', 'status', 'completed_at'])
        return temporary_upload
    except Exception:
        try:
            client.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=session.object_key)
        finally:
            session.status = MultipartUploadSession.StatusChoices.FAILED
            session.save(update_fields=['status'])
        raise


def abort_multipart_session(session):
    if session.status == MultipartUploadSession.StatusChoices.ABORTED:
        return
    if session.status != MultipartUploadSession.StatusChoices.INITIATED:
        raise ValueError('Only active multipart uploads can be aborted.')
    get_tigris_client().abort_multipart_upload(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=session.object_key,
        UploadId=session.upload_id,
    )
    session.status = MultipartUploadSession.StatusChoices.ABORTED
    session.save(update_fields=['status'])


def abort_expired_multipart_sessions():
    client = get_tigris_client()
    sessions = MultipartUploadSession.objects.filter(
        status=MultipartUploadSession.StatusChoices.INITIATED,
        expires_at__lte=timezone.now(),
    )
    aborted = 0
    for session in sessions.iterator():
        client.abort_multipart_upload(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME,
            Key=session.object_key,
            UploadId=session.upload_id,
        )
        session.status = MultipartUploadSession.StatusChoices.ABORTED
        session.save(update_fields=['status'])
        aborted += 1
    return aborted
