from django.db import models
from django.db import IntegrityError, transaction
from django.db.models import Q
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from rest_framework import mixins, viewsets, status, serializers
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication
from .permissions import (
    IsAdminRole, IsDiscussionAuthorOrInstructor, IsInstructorRole, IsInstructorOrAdminRole,
    IsInstructorOrSuperuser,
    IsStudentRole, HasDeviceAPIKey, PasswordResetRateThrottle,
    PasswordResetStatusRateThrottle, NFCEnrollmentRateThrottle,
    CanReadAccessLogPhoto,
    CanReadAccessLogPhotoImage,
)
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.renderers import BaseRenderer
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from django_filters import rest_framework as filters
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework_simplejwt.views import TokenObtainPairView
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.http import FileResponse, HttpResponse, Http404, StreamingHttpResponse
from django.urls import reverse
from django.utils.cache import patch_cache_control
from django.utils.http import content_disposition_header
from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.core import signing
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError as DjangoValidationError
from botocore.exceptions import ClientError
from PIL import Image, UnidentifiedImageError
from urllib.parse import quote
import hashlib
import mimetypes
import os
import re
import secrets

from .models import Section, User, Activity, ActivityAttachment, Submission, SubmissionAttachment, ActivityDiscussion, ActivityDiscussionAttachment, AccessLog, AccessLogPhoto, CabinetSession, CabinetEvent, Notification, TemporaryUpload, MultipartUploadSession, ActivityAnnouncement
from .models import PasswordResetRequest, PasswordRecoveryAuditEvent, NFCEnrollmentSession, PrivilegedUserAuditEvent, CabinetLocation
from .student_import import (
    MAX_IMPORT_FILE_BYTES,
    MAX_IMPORT_ROWS,
    build_custom_import_preview,
    build_custom_import_template,
    build_instructor,
    build_student,
    read_custom_instructor_import,
    read_custom_student_import,
    validate_instructor_rows,
    validate_student_rows,
)
from .serializers import (
    SectionSerializer,
    InstructorSectionSerializer,
    SectionInstructorSerializer,
    UserSerializer,
    ActivitySerializer,
    SubmissionSerializer,
    AccessLogSerializer,
    CabinetSessionSerializer,
    CabinetEventSerializer,
    NotificationSerializer,
    CustomTokenObtainPairSerializer,
    ActivityDiscussionSerializer,
    ActivityAnnouncementSerializer,
    PasswordResetRequestSerializer,
    PasswordChangeSerializer,
    PasswordResetStatusSerializer,
    PasswordResetCancellationSerializer,
    PasswordResetNFCVerificationSerializer,
    PasswordResetCabinetHandoffSerializer,
    CabinetRegistrationSerializer,
    PasswordResetConfirmationSerializer,
    PasswordResetTokenValidationSerializer,
    NFCEnrollmentRegistrationSerializer,
    AccessLogPhotoReadSerializer,
)
from .discussion_serializers import ActivityDiscussionSerializer
from .file_uploads import (
    MAX_STUDENT_SUBMISSION_BYTES,
    MAX_STUDENT_SUBMISSION_FILES,
    validate_student_submission_files,
    validate_uploaded_files,
)
from .tigris_uploads import (
    abort_multipart_session,
    abort_expired_multipart_sessions,
    complete_multipart_session,
    create_multipart_session,
    get_tigris_client,
    presign_upload_part,
)
from .excel_exports import branded_excel_response, format_duration
from django.contrib.auth.password_validation import validate_password
import secrets
import logging
import traceback

logger = logging.getLogger(__name__)
MAX_ACCESS_LOG_PHOTO_BYTES = 5 * 1024 * 1024
MAX_ACCESS_LOG_PHOTO_PIXELS = 20_000_000


def log_api_operation_failure(request, operation, status_code, error):
    source = 'unavailable'
    if error.__traceback__:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        source = f'{os.path.basename(frame.filename)}:{frame.lineno}:{frame.name}'
    logger.error(
        'API operation failed request_id=%s operation=%s status=%s exception_type=%s source=%s',
        getattr(request, 'api_request_id', 'unavailable'),
        operation,
        status_code,
        type(error).__name__,
        source,
    )


def requested_export_ids(request):
    raw_ids = request.data.get('ids')
    if not isinstance(raw_ids, list) or not raw_ids:
        return None
    try:
        return list(dict.fromkeys(int(value) for value in raw_ids))
    except (TypeError, ValueError):
        return None


def create_temporary_uploads(user, activity, uploaded_files):
    created = []
    try:
        with transaction.atomic():
            for uploaded_file in uploaded_files:
                upload = TemporaryUpload(user=user, activity=activity, file=uploaded_file)
                try:
                    upload.save()
                except Exception:
                    stored_name = upload.file.name
                    if stored_name.startswith('temp_uploads/'):
                        upload.file.storage.delete(stored_name)
                    raise
                created.append(upload)
    except Exception:
        for upload in created:
            stored_name = upload.file.name
            if stored_name:
                upload.file.storage.delete(stored_name)
            upload.delete()
        raise
    return created


def get_student_submission_usage(user, activity, request_data=None):
    existing_files, removal_errors = get_existing_submission_files_for_upload(user, activity, request_data or {})
    if removal_errors:
        return None, None, removal_errors
    uploads = list(TemporaryUpload.objects.filter(user=user, activity=activity))
    pending_sessions = list(MultipartUploadSession.objects.filter(
        user=user,
        activity=activity,
        status=MultipartUploadSession.StatusChoices.INITIATED,
        expires_at__gt=timezone.now(),
    ))
    try:
        total_size = sum(file.size for file in existing_files)
        total_size += sum(upload.file_size or upload.file.size for upload in uploads)
        total_size += sum(session.file_size for session in pending_sessions)
    except (OSError, ValueError, ClientError):
        return None, None, {'detail': ['Existing submission file sizes could not be verified.']}
    total_count = len(existing_files) + len(uploads) + len(pending_sessions)
    return total_count, total_size, {}


def get_existing_submission_files_for_upload(user, activity, request_data):
    raw_removed_ids = (
        request_data.getlist('removed_attachment_ids')
        if hasattr(request_data, 'getlist')
        else request_data.get('removed_attachment_ids', [])
    )
    if raw_removed_ids in (None, ''):
        raw_removed_ids = []
    elif not isinstance(raw_removed_ids, (list, tuple, set)):
        raw_removed_ids = [raw_removed_ids]
    try:
        removed_ids = {int(value) for value in raw_removed_ids if str(value).strip()}
    except (TypeError, ValueError):
        return [], {'removed_attachment_ids': ['File identifiers must be integers.']}
    raw_remove_primary = request_data.get('remove_primary_file', False)
    if isinstance(raw_remove_primary, bool):
        remove_primary_file = raw_remove_primary
    elif str(raw_remove_primary).strip().lower() in ('true', '1', 'yes', 'on'):
        remove_primary_file = True
    elif str(raw_remove_primary).strip().lower() in ('false', '0', 'no', 'off', ''):
        remove_primary_file = False
    else:
        return [], {'remove_primary_file': ['Choose whether to remove the existing primary file.']}

    submission = Submission.objects.filter(
        student=user,
        activity=activity,
    ).order_by('-submitted_at', '-pk').first()
    if not submission:
        if removed_ids or remove_primary_file:
            return [], {'removed_attachment_ids': ['The submission to update was not found.']}
        return [], {}

    attachments = list(submission.attachments.all())
    attachment_ids = {attachment.pk for attachment in attachments}
    attachment_names = {attachment.file.name for attachment in attachments if attachment.file}
    has_unattached_primary_file = bool(
        submission.file and submission.file.name not in attachment_names
    )
    allowed_removed_ids = attachment_ids
    if not removed_ids.issubset(allowed_removed_ids):
        return [], {'removed_attachment_ids': ['One or more files are not part of this submission.']}
    if remove_primary_file and not has_unattached_primary_file:
        return [], {'remove_primary_file': ['This submission has no separate primary file to remove.']}

    existing_files = [
        attachment.file
        for attachment in attachments
        if attachment.pk not in removed_ids
    ]
    if has_unattached_primary_file and not remove_primary_file:
        existing_files.append(submission.file)
    return existing_files, {}


def store_student_temporary_uploads(user, activity, uploaded_files, request_data):
    uploaded_files = list(uploaded_files)
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        existing_files = []
        if activity:
            count, total_size, usage_errors = get_student_submission_usage(user, activity, request_data)
            if usage_errors:
                return [], usage_errors, status.HTTP_503_SERVICE_UNAVAILABLE
            uploaded_size = sum(int(uploaded_file.size) for uploaded_file in uploaded_files)
            if count + len(uploaded_files) > MAX_STUDENT_SUBMISSION_FILES:
                return [], {'files': [f'A submission can contain at most {MAX_STUDENT_SUBMISSION_FILES} files.']}, status.HTTP_400_BAD_REQUEST
            if total_size + uploaded_size > MAX_STUDENT_SUBMISSION_BYTES:
                return [], {'files': ['Combined submission files exceed the configured total size limit.']}, status.HTTP_400_BAD_REQUEST
            existing_files, removal_errors = get_existing_submission_files_for_upload(user, activity, request_data)
            if removal_errors:
                return [], removal_errors, status.HTTP_400_BAD_REQUEST
            existing_files.extend(
                upload.file
                for upload in TemporaryUpload.objects.filter(user=user, activity=activity)
            )

        upload_errors = validate_student_submission_files(uploaded_files, existing_files)
        if upload_errors:
            return [], {'files': upload_errors}, status.HTTP_400_BAD_REQUEST
        uploads = create_temporary_uploads(user, activity, uploaded_files)
        for upload, uploaded_file in zip(uploads, uploaded_files):
            upload.original_filename = os.path.basename(str(uploaded_file.name or '').replace('\\', '/'))[:255]
            upload.file_size = int(uploaded_file.size)
            upload.content_type = str(uploaded_file.content_type or '')
            upload.save(update_fields=['original_filename', 'file_size', 'content_type'])
        return uploads, {}, None

def omit_response_fields(data, field_names):
    if isinstance(data, dict):
        for field_name in field_names:
            data.pop(field_name, None)
        for value in data.values():
            omit_response_fields(value, field_names)
    elif isinstance(data, list):
        for value in data:
            omit_response_fields(value, field_names)
    return data


def record_password_recovery_event(reset_request, event_type, outcome, reason_code='', actor_type='django', correlation_id=''):
    PasswordRecoveryAuditEvent.objects.create(
        recovery_request=reset_request,
        user=reset_request.user,
        event_type=event_type,
        outcome=outcome,
        reason_code=reason_code,
        actor_type=actor_type,
        correlation_id=correlation_id[:64],
    )


def get_authorized_access_log_photo_event(request, view, event_id):
    queryset = AccessLog.objects.select_related('photo', 'user__section')
    device_context = getattr(request, 'nfc_device_context', None)
    if device_context is not None:
        cabinet_name = str(device_context.get('cabinet_name') or '').strip()
        queryset = queryset.filter(cabinet_name=cabinet_name)
    elif request.user.role == User.RoleChoices.STUDENT:
        queryset = queryset.filter(user=request.user)
    elif request.user.role == User.RoleChoices.INSTRUCTOR:
        queryset = queryset.filter(
            Q(user__role=User.RoleChoices.STUDENT)
            & (Q(user__section__instructor=request.user) | Q(user__section__assigned_instructors=request.user))
        ).distinct()

    access_log = get_object_or_404(queryset, pk=event_id)
    view.check_object_permissions(request, access_log)
    return access_log


class AccessLogPhotoStatusView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]
    parser_classes = [JSONParser]

    def post(self, request, event_id, *args, **kwargs):
        device_context = getattr(request, 'nfc_device_context', {})
        cabinet_name = str(device_context.get('cabinet_name') or '').strip()
        access_log = get_object_or_404(
            AccessLog.objects.select_related('photo'),
            pk=event_id,
            cabinet_name=cabinet_name,
        )
        capture_status = request.data.get('status')
        if capture_status not in (
            AccessLogPhoto.CaptureStatusChoices.PENDING,
            AccessLogPhoto.CaptureStatusChoices.FAILED,
        ):
            return Response(
                {'success': False, 'error': 'Status must be pending or failed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        diagnostic_error = request.data.get('error', '')
        if not isinstance(diagnostic_error, str) or len(diagnostic_error) > 1000:
            return Response(
                {'success': False, 'error': 'Error must be a string of at most 1000 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            photo, _ = AccessLogPhoto.objects.select_for_update().get_or_create(access_log=access_log)
            if photo.image:
                return Response(
                    {'success': False, 'error': 'A photo has already been uploaded for this event.'},
                    status=status.HTTP_409_CONFLICT,
                )
            photo.capture_status = capture_status
            photo.captured_at = timezone.now() if capture_status == AccessLogPhoto.CaptureStatusChoices.FAILED else None
            photo.diagnostic_error = diagnostic_error.strip()
            photo.save(update_fields=['capture_status', 'captured_at', 'diagnostic_error'])

        return Response({
            'success': True,
            'event_id': access_log.pk,
            'capture_status': photo.capture_status,
            'captured_at': photo.captured_at,
            'error': photo.diagnostic_error,
        }, status=status.HTTP_200_OK)


class AccessLogPhotoUploadView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [HasDeviceAPIKey]
    parser_classes = [MultiPartParser, FormParser]

    def initialize_request(self, request, *args, **kwargs):
        self.photo_request_method = request.method
        return super().initialize_request(request, *args, **kwargs)

    def get_authenticators(self):
        if self.photo_request_method == 'POST':
            return []
        return super().get_authenticators()

    def get_permissions(self):
        if self.request.method == 'POST':
            return [HasDeviceAPIKey()]
        return [CanReadAccessLogPhoto()]

    def _authorized_access_log(self, request, event_id):
        return get_authorized_access_log_photo_event(request, self, event_id)

    def get(self, request, event_id, *args, **kwargs):
        access_log = self._authorized_access_log(request, event_id)
        photo = getattr(access_log, 'photo', None)
        student_status_only = getattr(request.user, 'role', None) == User.RoleChoices.STUDENT
        image_available = bool(
            photo and photo.image and photo.image.storage.exists(photo.image.name)
        )
        payload = {
            'event_id': access_log.pk,
            'capture_status': photo.capture_status if photo else None,
            'captured_at': photo.captured_at if photo and not student_status_only else None,
            'diagnostic_error': (photo.diagnostic_error or None) if photo and not student_status_only else None,
            'image_available': image_available,
            'image_endpoint': reverse('access_log_photo_image', args=[access_log.pk])
            if image_available else None,
        }
        return Response(AccessLogPhotoReadSerializer(payload).data, status=status.HTTP_200_OK)

    def post(self, request, event_id, *args, **kwargs):
        device_context = getattr(request, 'nfc_device_context', {})
        cabinet_name = str(device_context.get('cabinet_name') or '').strip()
        access_log = get_object_or_404(
            AccessLog.objects.select_related('photo'),
            pk=event_id,
            cabinet_name=cabinet_name,
        )
        uploaded_image = request.FILES.get('image')
        if uploaded_image is None:
            return Response(
                {'success': False, 'error': 'JPEG image is required in the image field.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if uploaded_image.size > MAX_ACCESS_LOG_PHOTO_BYTES:
            return Response(
                {'success': False, 'error': 'Image exceeds the 5 MB upload limit.'},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        try:
            with Image.open(uploaded_image) as image:
                if image.format != 'JPEG':
                    raise ValueError('Only JPEG images are accepted.')
                if image.width * image.height > MAX_ACCESS_LOG_PHOTO_PIXELS:
                    raise ValueError('Image dimensions exceed the allowed limit.')
                image.verify()
            uploaded_image.seek(0)
            with Image.open(uploaded_image) as image:
                image.load()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            return Response(
                {'success': False, 'error': 'Uploaded file is not a valid JPEG image.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        finally:
            uploaded_image.seek(0)

        with transaction.atomic():
            photo, _ = AccessLogPhoto.objects.select_for_update().get_or_create(access_log=access_log)
            if photo.image:
                return Response(
                    {'success': False, 'error': 'A photo has already been uploaded for this event.'},
                    status=status.HTTP_409_CONFLICT,
                )
            photo.image = uploaded_image
            photo.capture_status = AccessLogPhoto.CaptureStatusChoices.SUCCESS
            photo.captured_at = timezone.now()
            photo.diagnostic_error = ''
            try:
                photo.save()
            except IntegrityError:
                if photo.image and photo.image.storage.exists(photo.image.name):
                    photo.image.storage.delete(photo.image.name)
                return Response(
                    {'success': False, 'error': 'A photo has already been uploaded for this event.'},
                    status=status.HTTP_409_CONFLICT,
                )

        return Response({
            'success': True,
            'event_id': access_log.pk,
            'capture_status': photo.capture_status,
            'captured_at': photo.captured_at,
        }, status=status.HTTP_201_CREATED)


class JPEGRenderer(BaseRenderer):
    media_type = 'image/jpeg'
    format = 'jpg'
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


class AccessLogPhotoImageView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [CanReadAccessLogPhotoImage]
    renderer_classes = [*APIView.renderer_classes, JPEGRenderer]

    def get(self, request, event_id, *args, **kwargs):
        access_log = get_authorized_access_log_photo_event(request, self, event_id)
        photo = getattr(access_log, 'photo', None)
        if not photo or not photo.image or not photo.image.storage.exists(photo.image.name):
            return Response({'error': 'Photo image is unavailable.'}, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(photo.image.open('rb'), content_type='image/jpeg')
        response['Content-Disposition'] = f'inline; filename="access-log-{access_log.pk}.jpg"'
        response['X-Content-Type-Options'] = 'nosniff'
        patch_cache_control(response, private=True, no_store=True)
        return response


class SectionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Sections.
    Supports full CRUD operations on sections.
    """
    serializer_class = SectionSerializer
    authentication_classes = [JWTAuthentication]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['section_name', 'academic_year', 'year_level']
    ordering_fields = ['section_name']
    ordering = ['section_name']

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'overview']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.user.is_authenticated and request.user.role != User.RoleChoices.ADMIN:
            omit_response_fields(response.data, {'nfc_uid'})
        return response

    def get_serializer_class(self):
        user = getattr(self.request, 'user', None)
        if getattr(user, 'role', None) == 'instructor':
            return InstructorSectionSerializer
        return SectionSerializer

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        sections = response.data.get('results', []) if isinstance(response.data, dict) else response.data
        section_ids = [section.get('section_id') for section in sections]
        legacy_instructors = {}
        for section_id, instructor_id, first_name, last_name, username in User.objects.filter(
            role=User.RoleChoices.INSTRUCTOR,
            assigned_sections__section_id__in=section_ids,
        ).order_by('pk').values_list(
            'assigned_sections__section_id', 'pk', 'first_name', 'last_name', 'username',
        ):
            legacy_instructors.setdefault(section_id, (
                instructor_id,
                f'{first_name} {last_name}'.strip() or username,
            ))
        for section in sections:
            section_id = section.get('section_id')
            if not section.get('instructor') and section_id in legacy_instructors:
                section['instructor'], section['instructor_name'] = legacy_instructors[section_id]
            section['activity_count'] = Activity.objects.filter(
                Q(section_id=section_id) | Q(assigned_sections__section_id=section_id)
            ).distinct().count()
        return response

    def _instructor_section_filter(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return Section.objects.none()

        return Section.objects.filter(instructor=user)

    @action(detail=False, methods=['patch'], url_path='assign-instructor')
    def assign_instructor(self, request):
        section_ids = request.data.get('section_ids')
        instructor_id = request.data.get('instructor_id')
        if not isinstance(section_ids, list) or not section_ids:
            return Response({'section_ids': ['Select at least one section.']}, status=status.HTTP_400_BAD_REQUEST)
        if any(not isinstance(section_id, int) or isinstance(section_id, bool) or section_id < 1 for section_id in section_ids):
            return Response({'section_ids': ['Section IDs must be positive integers.']}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(instructor_id, int) or isinstance(instructor_id, bool):
            return Response({'instructor_id': ['Select a registered instructor.']}, status=status.HTTP_400_BAD_REQUEST)

        unique_ids = list(dict.fromkeys(section_ids))
        instructor = User.objects.filter(
            pk=instructor_id,
            role=User.RoleChoices.INSTRUCTOR,
            is_active=True,
        ).first()
        if not instructor:
            return Response({'instructor_id': ['Select a registered instructor.']}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            sections = list(Section.objects.select_for_update().filter(section_id__in=unique_ids))
            if len(sections) != len(unique_ids):
                return Response({'section_ids': ['One or more selected sections no longer exist.']}, status=status.HTTP_404_NOT_FOUND)

            serializer_class = self.get_serializer_class()
            for section in sections:
                serializer = serializer_class(
                    section,
                    data={'instructor': instructor.pk},
                    partial=True,
                    context=self.get_serializer_context(),
                )
                serializer.is_valid(raise_exception=True)
                serializer.save()

            response_data = serializer_class(
                sections,
                many=True,
                context=self.get_serializer_context(),
            ).data

        return Response(response_data)

    def get_queryset(self):
        user = self.request.user
        queryset = Section.objects.annotate(
            actual_student_count=models.Count(
                'users',
                filter=models.Q(users__role=User.RoleChoices.STUDENT),
                distinct=True,
            )
        )
        if user.role == 'admin':
            return queryset
        if user.role == 'instructor':
            return queryset.filter(models.Q(instructor=user) | models.Q(assigned_instructors=user)).distinct()
        return Section.objects.none()

    @action(detail=True, methods=['get'], url_path='overview')
    def overview(self, request, pk=None):
        section = self.get_object()
        students = User.objects.filter(
            role=User.RoleChoices.STUDENT,
            section=section,
        ).order_by('last_name', 'first_name')
        activities = Activity.objects.filter(
            models.Q(section=section) | models.Q(assigned_sections=section)
        ).select_related('created_by', 'section').distinct().order_by('-updated_at', '-created_at')
        submissions = Submission.objects.filter(
            student__role=User.RoleChoices.STUDENT,
            student__section=section,
            activity__in=activities,
        ).select_related('student', 'activity').order_by('-submitted_at')
        access_logs = AccessLog.objects.filter(
            user__role=User.RoleChoices.STUDENT,
            user__section=section,
        ).select_related('user', 'cabinet_session').order_by('-access_time')

        student_count = students.count()
        activity_count = activities.count()
        submitted_count = submissions.values('student_id', 'activity_id').distinct().count()
        expected_count = student_count * activity_count
        late_count = submissions.filter(submitted_at__gt=models.F('activity__due_date')).values(
            'student_id', 'activity_id'
        ).distinct().count()

        assigned_stations = list(
            activities.exclude(cabinet_station='').values_list('cabinet_station', flat=True).distinct()
        )
        cabinet_stations = []
        for station in assigned_stations:
            current_session = CabinetSession.objects.filter(
                station=station,
                status=CabinetSession.StatusChoices.OPEN,
            ).order_by('-opened_at').first()
            cabinet_stations.append({
                'station': station,
                'status': 'Occupied' if current_session else 'Available',
            })

        context = {'request': request}
        return Response({
            'section': self.get_serializer(section).data,
            'counts': {
                'students': student_count,
                'activities': activity_count,
                'submitted': submitted_count,
                'expected': expected_count,
                'missing': max(0, expected_count - submitted_count),
                'late': late_count,
                'pending_review': submissions.filter(score__isnull=True).count(),
            },
            'students': UserSerializer(students[:5], many=True, context=context).data,
            'activities': ActivitySerializer(activities[:4], many=True, context=context).data,
            'recent_submissions': SubmissionSerializer(submissions[:5], many=True, context=context).data,
            'access_logs': AccessLogSerializer(access_logs[:5], many=True, context=context).data,
            'cabinet_stations': cabinet_stations,
        })


ACADEMIC_FILE_PREVIEW_MAX_AGE = 600
ACADEMIC_FILE_PREVIEW_SALT = 'taptrack.academic-file-preview'


def instructor_can_access_activity(user, activity):
    return bool(
        user.role == User.RoleChoices.INSTRUCTOR
        and (
            activity.created_by_id == user.pk
            or activity.assigned_instructor_id == user.pk
            or (activity.section_id and (
                activity.section.instructor_id == user.pk
                or activity.section.assigned_instructors.filter(pk=user.pk).exists()
            ))
            or activity.assigned_sections.filter(
                Q(instructor_id=user.pk) | Q(assigned_instructors__pk=user.pk),
            ).exists()
        )
    )


def get_academic_attachment(kind, attachment_id):
    if kind == 'activity':
        attachment = get_object_or_404(
            ActivityAttachment.objects.select_related('activity', 'activity__section', 'activity__created_by', 'activity__assigned_instructor'),
            pk=attachment_id,
        )
        return attachment, attachment.file, attachment.activity, None
    if kind == 'submission':
        attachment = get_object_or_404(
            SubmissionAttachment.objects.select_related(
                'submission', 'submission__student', 'submission__student__section',
                'submission__activity', 'submission__activity__section',
                'submission__activity__created_by', 'submission__activity__assigned_instructor',
            ),
            pk=attachment_id,
        )
        return attachment, attachment.file, attachment.submission.activity, attachment.submission
    if kind == 'submission_file':
        submission = get_object_or_404(
            Submission.objects.select_related(
                'student', 'student__section', 'activity', 'activity__section',
                'activity__created_by', 'activity__assigned_instructor',
            ),
            pk=attachment_id,
        )
        if not submission.file:
            raise Http404
        return submission, submission.file, submission.activity, submission
    if kind == 'discussion':
        attachment = get_object_or_404(
            ActivityDiscussionAttachment.objects.select_related(
                'discussion', 'discussion__activity', 'discussion__activity__section',
                'discussion__activity__created_by', 'discussion__activity__assigned_instructor',
            ),
            pk=attachment_id,
        )
        return attachment, attachment.file, attachment.discussion.activity, None
    raise Http404


def academic_file_is_authorized(user, kind, activity, submission):
    if not user or not user.is_authenticated or not user.is_active:
        return False
    if user.role == User.RoleChoices.ADMIN:
        return True
    if user.role == User.RoleChoices.STUDENT:
        if submission and submission.student_id != user.pk:
            return False
        return student_can_access_activity(user, activity)
    if user.role == User.RoleChoices.INSTRUCTOR:
        if kind in ('submission', 'submission_file') and submission and submission.student and submission.student.section:
            section = submission.student.section
            if section.instructor_id == user.pk or section.assigned_instructors.filter(pk=user.pk).exists():
                return True
        return instructor_can_access_activity(user, activity)
    return False


def academic_file_metadata(record, file_field):
    original_name = getattr(record, 'original_filename', '') or os.path.basename(file_field.name or '')
    filename = os.path.basename(str(original_name).replace('\\', '/')) or 'Attachment'
    suffix = os.path.splitext(filename)[1].lower()
    type_by_extension = {
        '.jpg': ('image/jpeg', 'image'), '.jpeg': ('image/jpeg', 'image'),
        '.png': ('image/png', 'image'), '.webp': ('image/webp', 'image'),
        '.gif': ('image/gif', 'image'), '.pdf': ('application/pdf', 'pdf'),
        '.mp4': ('video/mp4', 'video'), '.webm': ('video/webm', 'video'),
        '.mp3': ('audio/mpeg', 'audio'), '.wav': ('audio/wav', 'audio'),
        '.txt': ('text/plain', 'text'), '.csv': ('text/plain', 'text'),
    }
    content_type, preview_type = type_by_extension.get(suffix, ('application/octet-stream', 'unsupported'))
    try:
        size = file_field.size
    except (OSError, ValueError, ClientError):
        size = getattr(record, 'file_size', 0) or 0
    return filename, size, content_type, preview_type


def academic_file_cookie_name(kind, attachment_id):
    return f'taptrack_file_preview_{kind}_{attachment_id}'


def academic_file_presigned_urls(file_field, filename, content_type):
    storage = file_field.storage
    bucket_name = getattr(storage, 'bucket_name', None)
    connection = getattr(storage, 'connection', None)
    if not bucket_name or connection is None:
        return None
    client = connection.meta.client
    key = storage._normalize_name(file_field.name)
    common_params = {
        'Bucket': bucket_name,
        'Key': key,
        'ResponseContentType': content_type,
        'ResponseCacheControl': 'private, no-store',
    }
    expires_in = settings.AWS_QUERYSTRING_EXPIRE
    return {
        'content_url': client.generate_presigned_url(
            'get_object',
            Params={
                **common_params,
                'ResponseContentDisposition': content_disposition_header(False, filename),
            },
            ExpiresIn=expires_in,
            HttpMethod='GET',
        ),
        'download_url': client.generate_presigned_url(
            'get_object',
            Params={
                **common_params,
                'ResponseContentDisposition': content_disposition_header(True, filename),
            },
            ExpiresIn=expires_in,
            HttpMethod='GET',
        ),
    }


class AcademicFilePreviewAuthorizeView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, kind, attachment_id, *args, **kwargs):
        record, file_field, activity, submission = get_academic_attachment(kind, attachment_id)
        if not academic_file_is_authorized(request.user, kind, activity, submission):
            raise Http404
        if not file_field or not file_field.name:
            raise NotFound('This attachment record exists, but its file is missing from storage. Restore it from a backup or ask the owner to upload it again.')
        try:
            if not file_field.storage.exists(file_field.name):
                raise NotFound('This attachment record exists, but its file is missing from storage. Restore it from a backup or ask the owner to upload it again.')
            filename, size, content_type, preview_type = academic_file_metadata(record, file_field)
            signed_urls = academic_file_presigned_urls(file_field, filename, content_type)
        except NotFound:
            raise
        except Exception as error:
            request_id = getattr(request, 'api_request_id', 'unavailable')
            logger.error(
                'File preview authorization failed request_id=%s status=%s exception_type=%s',
                request_id,
                status.HTTP_503_SERVICE_UNAVAILABLE,
                type(error).__name__,
            )
            return Response({
                'detail': 'File storage is temporarily unavailable. Please retry.',
                'code': 'storage_unavailable',
                'request_id': request_id,
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        content_url = reverse('academic_file_preview_content', args=[kind, attachment_id])
        payload = {
            'filename': filename,
            'size': size,
            'content_type': content_type,
            'preview_type': preview_type,
            'preview_supported': preview_type != 'unsupported',
            **(signed_urls or {
                'content_url': content_url,
                'download_url': f'{content_url}?download=1',
            }),
        }
        response = Response(payload)
        if not signed_urls:
            cookie_name = academic_file_cookie_name(kind, attachment_id)
            token = signing.dumps({
                'user_id': request.user.pk,
                'kind': kind,
                'attachment_id': attachment_id,
            }, salt=ACADEMIC_FILE_PREVIEW_SALT)
            response.set_cookie(
                cookie_name,
                token,
                max_age=ACADEMIC_FILE_PREVIEW_MAX_AGE,
                httponly=True,
                secure=request.is_secure(),
                samesite='None' if request.is_secure() else 'Lax',
                path=content_url.rsplit('/', 1)[0] + '/',
            )
        patch_cache_control(response, private=True, no_store=True)
        return response

    def delete(self, request, kind, attachment_id, *args, **kwargs):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        content_url = reverse('academic_file_preview_content', args=[kind, attachment_id])
        response.delete_cookie(
            academic_file_cookie_name(kind, attachment_id),
            path=content_url.rsplit('/', 1)[0] + '/',
            samesite='Lax',
        )
        return response


def stream_file_range(file_field, start, length):
    file_handle = file_field.open('rb')
    file_handle.seek(start)

    def iterator():
        remaining = length
        try:
            while remaining > 0:
                chunk = file_handle.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            file_handle.close()

    return iterator()


def open_storage_object(file_field, byte_range=None):
    storage = file_field.storage
    bucket_name = getattr(storage, 'bucket_name', None)
    connection = getattr(storage, 'connection', None)
    if not bucket_name or connection is None:
        return None

    key = storage._normalize_name(file_field.name)
    request = {'Bucket': bucket_name, 'Key': key}
    if byte_range:
        request['Range'] = f'bytes={byte_range[0]}-{byte_range[1]}'
    return connection.meta.client.get_object(**request)['Body']


def stream_storage_object(body):
    try:
        while True:
            chunk = body.read(64 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        body.close()


class AcademicFilePreviewContentView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, kind, attachment_id, *args, **kwargs):
        cookie = request.COOKIES.get(academic_file_cookie_name(kind, attachment_id))
        try:
            token = signing.loads(cookie or '', salt=ACADEMIC_FILE_PREVIEW_SALT, max_age=ACADEMIC_FILE_PREVIEW_MAX_AGE)
        except signing.BadSignature:
            raise Http404
        if token.get('kind') != kind or int(token.get('attachment_id', -1)) != attachment_id:
            raise Http404
        user = User.objects.filter(pk=token.get('user_id'), is_active=True).first()
        record, file_field, activity, submission = get_academic_attachment(kind, attachment_id)
        if not academic_file_is_authorized(user, kind, activity, submission):
            raise Http404
        if not file_field or not file_field.name:
            raise NotFound('This attachment record exists, but its file is missing from storage. Restore it from a backup or ask the owner to upload it again.')

        try:
            if not file_field.storage.exists(file_field.name):
                raise NotFound('This attachment record exists, but its file is missing from storage. Restore it from a backup or ask the owner to upload it again.')
            filename, size, content_type, preview_type = academic_file_metadata(record, file_field)
            requested_download = request.query_params.get('download') == '1'
            as_attachment = requested_download or preview_type == 'unsupported'
            range_header = request.headers.get('Range', '')
            response = None
            if range_header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header.strip())
                if not match or size <= 0:
                    response = HttpResponse(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)
                    response['Content-Range'] = f'bytes */{size}'
                    return response
                start_text, end_text = match.groups()
                if not start_text:
                    suffix_length = int(end_text or '0')
                    start = max(0, size - suffix_length)
                    end = size - 1
                else:
                    start = int(start_text)
                    end = min(int(end_text), size - 1) if end_text else size - 1
                if start >= size or end < start:
                    response = HttpResponse(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)
                    response['Content-Range'] = f'bytes */{size}'
                    return response
                length = end - start + 1
                body = open_storage_object(file_field, (start, end))
                stream = stream_storage_object(body) if body else stream_file_range(file_field, start, length)
                response = StreamingHttpResponse(stream, status=status.HTTP_206_PARTIAL_CONTENT, content_type=content_type)
                response['Content-Range'] = f'bytes {start}-{end}/{size}'
                response['Content-Length'] = str(length)
            else:
                body = open_storage_object(file_field)
                response = StreamingHttpResponse(stream_storage_object(body), content_type=content_type) if body else FileResponse(file_field.open('rb'), content_type=content_type)
                response['Content-Length'] = str(size)
        except NotFound:
            raise
        except Exception as error:
            request_id = getattr(request, 'api_request_id', 'unavailable')
            logger.error(
                'File content request failed request_id=%s status=%s exception_type=%s',
                request_id,
                status.HTTP_503_SERVICE_UNAVAILABLE,
                type(error).__name__,
            )
            return Response({
                'detail': 'File storage is temporarily unavailable. Please retry.',
                'code': 'storage_unavailable',
                'request_id': request_id,
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        response['Content-Disposition'] = content_disposition_header(as_attachment, filename)
        response['Accept-Ranges'] = 'bytes'
        response['X-Content-Type-Options'] = 'nosniff'
        response['X-Frame-Options'] = 'SAMEORIGIN'
        response['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'self'; sandbox"
        patch_cache_control(response, private=True, no_store=True)
        return response


def get_owned_multipart_session(request, session_id):
    session = MultipartUploadSession.objects.filter(pk=session_id, user=request.user).first()
    if not session:
        raise Http404
    if session.status != MultipartUploadSession.StatusChoices.INITIATED:
        raise PermissionDenied('This multipart upload session is no longer active.')
    if session.expires_at <= timezone.now():
        raise PermissionDenied('This multipart upload session has expired. Start a new upload.')
    if not student_can_access_activity(request.user, session.activity):
        raise Http404
    return session


def multipart_upload_response(upload, session_id=None):
    return {
        'id': upload.pk,
        'temp_upload_id': upload.pk,
        'upload_session_id': str(session_id) if session_id else None,
        'name': upload.original_filename or os.path.basename(upload.file.name),
        'filename': upload.original_filename or os.path.basename(upload.file.name),
        'size': upload.file_size,
        'content_type': upload.content_type,
        'uploaded_at': upload.uploaded_at,
        'preview_kind': 'submission_file',
    }


class StudentMultipartUploadStartView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]

    def post(self, request, *args, **kwargs):
        activity_id = request.data.get('activity')
        filename = request.data.get('filename')
        try:
            file_size = int(request.data.get('file_size'))
        except (TypeError, ValueError):
            return Response({'file_size': ['Provide the video size in bytes.']}, status=status.HTTP_400_BAD_REQUEST)

        activity = Activity.objects.filter(pk=activity_id).first()
        if not activity or not student_can_access_activity(request.user, activity):
            raise Http404
        if activity.due_date and activity.due_date < timezone.now() and not activity.allow_resubmission:
            return Response({'detail': 'The deadline has passed and late submissions are not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        if settings.MEDIA_STORAGE_BACKEND != 's3':
            return Response({'detail': 'Direct multipart upload requires configured Tigris storage.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            if cache.add('taptrack-tigris-multipart-cleanup', True, timeout=3600):
                abort_expired_multipart_sessions()
        except Exception as error:
            log_api_operation_failure(
                request,
                'cleanup expired multipart uploads',
                status.HTTP_503_SERVICE_UNAVAILABLE,
                error,
            )

        with transaction.atomic():
            User.objects.select_for_update().get(pk=request.user.pk)
            pending_sessions = list(MultipartUploadSession.objects.filter(
                user=request.user,
                activity=activity,
                status=MultipartUploadSession.StatusChoices.INITIATED,
                expires_at__gt=timezone.now(),
            ))
            if len(pending_sessions) >= 2:
                return Response({'detail': 'Finish or cancel an existing video upload before starting another.'}, status=status.HTTP_409_CONFLICT)
            existing_count, existing_size, usage_errors = get_student_submission_usage(request.user, activity, request.data)
            if usage_errors:
                return Response(usage_errors, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            if existing_count >= MAX_STUDENT_SUBMISSION_FILES:
                return Response({'files': [f'A submission can contain at most {MAX_STUDENT_SUBMISSION_FILES} files.']}, status=status.HTTP_400_BAD_REQUEST)
            if existing_size + file_size > MAX_STUDENT_SUBMISSION_BYTES:
                return Response({'files': ['Combined submission files exceed the configured total size limit.']}, status=status.HTTP_400_BAD_REQUEST)

            try:
                session = create_multipart_session(request.user, activity, filename, file_size)
            except ValueError as error:
                return Response({'file': [str(error)]}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as error:
                log_api_operation_failure(
                    request,
                    'initialize multipart upload',
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    error,
                )
                return Response({
                    'detail': 'Upload initialization failed. Please retry.',
                    'code': 'upload_initialization_failed',
                    'request_id': getattr(request, 'api_request_id', 'unavailable'),
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({
            'upload_id': str(session.pk),
            'part_size': session.part_size,
            'total_parts': session.total_parts,
            'expires_at': session.expires_at,
            'filename': session.original_filename,
            'file_size': session.file_size,
        }, status=status.HTTP_201_CREATED)


class StudentMultipartUploadPartView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]

    def post(self, request, session_id, part_number, *args, **kwargs):
        session = get_owned_multipart_session(request, session_id)
        try:
            url = presign_upload_part(session, part_number)
        except ValueError as error:
            return Response({'part_number': [str(error)]}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as error:
            log_api_operation_failure(
                request,
                'authorize multipart part',
                status.HTTP_503_SERVICE_UNAVAILABLE,
                error,
            )
            return Response({
                'detail': 'File storage rejected the upload authorization. Please retry.',
                'code': 'part_authorization_failed',
                'request_id': getattr(request, 'api_request_id', 'unavailable'),
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'url': url, 'expires_in': settings.TAPTRACK_PRESIGNED_PART_URL_TTL})


class StudentMultipartUploadCompleteView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]

    def post(self, request, session_id, *args, **kwargs):
        session = MultipartUploadSession.objects.filter(pk=session_id, user=request.user).first()
        if not session:
            raise Http404
        if session.status == MultipartUploadSession.StatusChoices.COMPLETED and session.temporary_upload_id:
            return Response(multipart_upload_response(session.temporary_upload, session.pk))
        if session.status != MultipartUploadSession.StatusChoices.INITIATED or session.expires_at <= timezone.now():
            return Response({'detail': 'This multipart upload session is no longer active.'}, status=status.HTTP_409_CONFLICT)
        if not student_can_access_activity(request.user, session.activity):
            raise Http404
        existing_count, existing_size, usage_errors = get_student_submission_usage(request.user, session.activity)
        if usage_errors:
            return Response(usage_errors, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if existing_count > MAX_STUDENT_SUBMISSION_FILES or existing_size > MAX_STUDENT_SUBMISSION_BYTES:
            return Response({'detail': 'This upload would exceed the configured submission count or size limit.'}, status=status.HTTP_409_CONFLICT)
        try:
            upload = complete_multipart_session(session, request.data.get('parts'))
        except ValueError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as error:
            log_api_operation_failure(
                request,
                'complete and verify multipart upload',
                status.HTTP_503_SERVICE_UNAVAILABLE,
                error,
            )
            return Response({
                'detail': 'Unable to complete multipart upload. Please retry.',
                'code': 'multipart_completion_failed',
                'request_id': getattr(request, 'api_request_id', 'unavailable'),
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(multipart_upload_response(upload, session.pk), status=status.HTTP_201_CREATED)


class StudentMultipartUploadAbortView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]

    def post(self, request, session_id, *args, **kwargs):
        session = MultipartUploadSession.objects.filter(pk=session_id, user=request.user).first()
        if not session:
            raise Http404
        if session.status == MultipartUploadSession.StatusChoices.ABORTED:
            return Response(status=status.HTTP_204_NO_CONTENT)
        if session.status != MultipartUploadSession.StatusChoices.INITIATED:
            return Response({'detail': 'Only an active upload can be aborted.'}, status=status.HTTP_409_CONFLICT)
        try:
            abort_multipart_session(session)
        except Exception as error:
            log_api_operation_failure(
                request,
                'abort multipart upload',
                status.HTTP_503_SERVICE_UNAVAILABLE,
                error,
            )
            return Response({
                'detail': 'Upload cancellation could not finish. Cleanup will retry automatically.',
                'code': 'multipart_abort_failed',
                'request_id': getattr(request, 'api_request_id', 'unavailable'),
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(status=status.HTTP_204_NO_CONTENT)


def get_custom_user_import(role, uploaded_file):
    if role == User.RoleChoices.STUDENT:
        rows, file_errors = read_custom_student_import(uploaded_file)
        prepared, validation_errors = validate_student_rows(rows) if rows else ([], [])
    elif role == User.RoleChoices.INSTRUCTOR:
        rows, file_errors = read_custom_instructor_import(uploaded_file)
        prepared, validation_errors = validate_instructor_rows(rows) if rows else ([], [])
    else:
        raise serializers.ValidationError({'role': 'Choose Student or Instructor.'})
    errors = file_errors + validation_errors
    return prepared, errors, build_custom_import_preview(prepared, errors, role)


def get_custom_user_import_batch(role, uploaded_files):
    reader = {
        User.RoleChoices.STUDENT: read_custom_student_import,
        User.RoleChoices.INSTRUCTOR: read_custom_instructor_import,
    }.get(role)
    if reader is None:
        raise serializers.ValidationError({'role': 'Choose Student or Instructor.'})

    rows = []
    file_errors = []
    row_sources = {}
    for uploaded_file in uploaded_files:
        filename = os.path.basename(str(getattr(uploaded_file, 'name', '') or 'uploaded file'))
        file_rows, errors = reader(uploaded_file)
        for error in errors:
            file_errors.append({
                **error,
                'row': '-',
                'source_row': error.get('row'),
                'file': filename,
            })

        for row in file_rows:
            if len(rows) >= MAX_IMPORT_ROWS:
                file_errors.append({
                    'row': '-',
                    'column': 'file',
                    'file': filename,
                    'message': f'An import batch can contain at most {MAX_IMPORT_ROWS} total rows.',
                })
                break
            source_row = row.get('row_number')
            row_number = len(rows) + 2
            row['source_file'] = filename
            row['source_row_number'] = source_row
            row['row_number'] = row_number
            row_sources[row_number] = (filename, source_row)
            rows.append(row)
        if len(rows) >= MAX_IMPORT_ROWS:
            break

    if role == User.RoleChoices.STUDENT:
        prepared, validation_errors = validate_student_rows(rows) if rows else ([], [])
    else:
        prepared, validation_errors = validate_instructor_rows(rows) if rows else ([], [])
    for error in validation_errors:
        source = row_sources.get(error.get('row'))
        if source:
            error['file'], error['source_row'] = source

    errors = file_errors + validation_errors
    return prepared, errors, build_custom_import_preview(prepared, errors, role)


def create_custom_import_users(role, rows):
    created = []
    with transaction.atomic():
        for row in rows:
            user = build_student(row) if role == User.RoleChoices.STUDENT else build_instructor(row)
            user.full_clean()
            user.save()
            if role == User.RoleChoices.INSTRUCTOR:
                section_ids = getattr(user, '_pending_section_ids', [])
                user.assigned_sections.set(section_ids)
            created.append(user.pk)
    return created


class AdminUserImportTemplateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request, *args, **kwargs):
        role = str(request.query_params.get('role') or '').strip().lower()
        file_format = str(request.query_params.get('file_format') or 'xlsx').strip().lower()
        if role not in (User.RoleChoices.STUDENT, User.RoleChoices.INSTRUCTOR):
            return Response({'role': 'Choose Student or Instructor.'}, status=status.HTTP_400_BAD_REQUEST)
        if file_format not in ('xlsx', 'csv'):
            return Response({'format': 'Choose xlsx or csv.'}, status=status.HTTP_400_BAD_REQUEST)

        content, content_type, filename = build_custom_import_template(role, file_format)
        response = HttpResponse(content, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['X-Content-Type-Options'] = 'nosniff'
        return response


class AdminUserImportPreviewView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        role = str(request.data.get('role') or '').strip().lower()
        if role not in (User.RoleChoices.STUDENT, User.RoleChoices.INSTRUCTOR):
            return Response({'role': ['Choose Student or Instructor.']}, status=status.HTTP_400_BAD_REQUEST)
        uploaded_files = request.FILES.getlist('files') or request.FILES.getlist('file')
        if not uploaded_files:
            return Response({'file': ['Choose one or more .xlsx or .csv files.']}, status=status.HTTP_400_BAD_REQUEST)
        if any(uploaded_file.size > MAX_IMPORT_FILE_BYTES for uploaded_file in uploaded_files):
            return Response({'file': ['The file must be 10 MB or smaller.']}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        prepared, errors, report = get_custom_user_import_batch(role, uploaded_files)
        return Response({'role': role, **report}, status=status.HTTP_200_OK)


class AdminUserImportConfirmView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        role = str(request.data.get('role') or '').strip().lower()
        if role not in (User.RoleChoices.STUDENT, User.RoleChoices.INSTRUCTOR):
            return Response({'role': ['Choose Student or Instructor.']}, status=status.HTTP_400_BAD_REQUEST)
        uploaded_files = request.FILES.getlist('files') or request.FILES.getlist('file')
        if not uploaded_files:
            return Response({'file': ['Re-upload the original files to confirm the import.']}, status=status.HTTP_400_BAD_REQUEST)
        if any(uploaded_file.size > MAX_IMPORT_FILE_BYTES for uploaded_file in uploaded_files):
            return Response({'file': ['The file must be 10 MB or smaller.']}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        prepared, errors, report = get_custom_user_import_batch(role, uploaded_files)
        errors_by_row = {}
        global_errors = []
        for error in errors:
            row_number = error.get('row')
            if isinstance(row_number, int) or str(row_number).isdigit():
                errors_by_row.setdefault(int(row_number), []).append(error)
            else:
                global_errors.append(error)

        if global_errors:
            return Response({
                **report,
                'successfully_imported': 0,
                'skipped': report['total_rows'],
                'failed': 0,
                'errors': errors,
            }, status=status.HTTP_400_BAD_REQUEST)

        valid_rows = [row for row in prepared if not errors_by_row.get(int(row.get('row_number') or 0))]
        skipped = report['invalid_rows'] + report['duplicate_rows']
        if not valid_rows:
            return Response({
                **report,
                'successfully_imported': 0,
                'skipped': skipped,
                'failed': 0,
                'errors': errors,
            }, status=status.HTTP_200_OK)

        try:
            created_ids = create_custom_import_users(role, valid_rows)
        except (DjangoValidationError, IntegrityError) as error:
            logger.warning('User import confirmation failed; transaction rolled back: %s', error)
            return Response({
                **report,
                'successfully_imported': 0,
                'skipped': skipped,
                'failed': len(valid_rows),
                'errors': [*errors, {'row': '-', 'column': 'database', 'message': 'The import conflicted with current data. No records were imported.'}],
            }, status=status.HTTP_409_CONFLICT)

        return Response({
            **report,
            'successfully_imported': len(created_ids),
            'skipped': skipped,
            'failed': 0,
            'errors': errors,
        }, status=status.HTTP_201_CREATED)


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Users.
    Supports full CRUD operations on users with filtering by role and section.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    authentication_classes = [JWTAuthentication]

    def get_permissions(self):
        if self.action == 'provisioning_permissions':
            return [IsAuthenticated()]
        if self.action in ['profile_details', 'user_activities', 'user_submissions']:
            return [IsAuthenticated(), IsInstructorOrAdminRole()]
        if self.action in ['list', 'retrieve', 'profile', 'access_logs', 'update', 'partial_update', 'update_profile', 'change_password', 'upload_profile_image', 'remove_profile_image']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.user.is_authenticated and request.user.role != User.RoleChoices.ADMIN:
            omit_response_fields(response.data, {'nfc_uid'})
        return response

    def _instructor_student_filter(self):
        user = self.request.user
        filters = Q(role='student')
        instructor_filters = Q(section__instructor=user) | Q(section__assigned_instructors=user)
        return User.objects.filter(filters & instructor_filters).distinct()

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return User.objects.all()
        if user.role == 'instructor':
            queryset = self._instructor_student_filter()
            section_id = self.request.query_params.get('section')
            return queryset.filter(section_id=section_id) if section_id else queryset
        if user.role == 'student':
            return User.objects.filter(pk=user.pk)
        return User.objects.none()

    @action(detail=False, methods=['get'], url_path='provisioning-permissions')
    def provisioning_permissions(self, request):
        user = request.user
        return Response({
            'can_provision_administrators': bool(
                user.is_superuser or user.has_perm('api.provision_administrator')
            ),
        })

    @action(detail=False, methods=['post'], url_path='export-excel')
    def export_excel(self, request):
        selected_ids = requested_export_ids(request)
        if selected_ids is None:
            return Response({'ids': ['Select one or more users to export.']}, status=status.HTTP_400_BAD_REQUEST)

        users = self.get_queryset().filter(pk__in=selected_ids).select_related('section').prefetch_related(
            'assigned_sections',
        ).order_by('pk')
        record_count = users.count()
        if not record_count:
            return Response({'ids': ['No selected users are available to export.']}, status=status.HTTP_400_BAD_REQUEST)

        def export_rows():
            for user in users.iterator(chunk_size=500):
                full_name = f'{user.first_name} {user.last_name}'.strip()
                if user.role == User.RoleChoices.INSTRUCTOR:
                    sections = '; '.join(section.section_name for section in user.assigned_sections.all())
                else:
                    sections = user.section.section_name if user.section else ''
                yield (
                    full_name,
                    user.username,
                    user.student_id or '',
                    user.instructor_id or '',
                    user.email,
                    user.role,
                    sections,
                    'Active' if user.is_active else 'Inactive',
                )

        return branded_excel_response(
            report_name='Users Management Report',
            filename='users-management-report.xlsx',
            headers=('Full Name', 'Username', 'Student ID', 'Instructor ID', 'Email', 'Role', 'Section(s)', 'Account Status'),
            rows=export_rows(),
            record_count=record_count,
            scope='Selected users',
        )

    @action(detail=False, methods=['get'])
    def profile(self, request):
        serializer = self.get_serializer(request.user, context={'request': request})
        profile_data = serializer.data
        if request.user.role == User.RoleChoices.STUDENT:
            section = request.user.section
            instructors = []
            if section:
                primary = section.instructor
                if primary and primary.role == User.RoleChoices.INSTRUCTOR:
                    instructors.append(primary)
                assigned = section.assigned_instructors.filter(role=User.RoleChoices.INSTRUCTOR).exclude(
                    pk__in=[instructor.pk for instructor in instructors]
                ).order_by('last_name', 'first_name', 'pk')
                instructors.extend(assigned)
            profile_data['section_instructors'] = SectionInstructorSerializer(
                instructors,
                many=True,
                context={'request': request},
            ).data
        return Response(profile_data)

    def _profile_activities(self, profile_user):
        activities = Activity.objects.select_related('created_by', 'section')
        if profile_user.role == User.RoleChoices.STUDENT:
            return activities.filter(
                Q(section__users=profile_user) | Q(assigned_sections__users=profile_user)
            ).distinct().order_by('-created_at', '-pk')
        if profile_user.role == User.RoleChoices.INSTRUCTOR:
            return activities.filter(
                Q(created_by=profile_user)
                | Q(assigned_instructor=profile_user)
                | Q(section__instructor=profile_user)
                | Q(assigned_sections__assigned_instructors=profile_user)
            ).distinct().order_by('-created_at', '-pk')
        return activities.filter(created_by=profile_user).order_by('-created_at', '-pk')

    @action(detail=True, methods=['get'], url_path='access-logs')
    def access_logs(self, request, pk=None):
        profile_user = self.get_object()
        logs = AccessLog.objects.filter(user=profile_user).select_related(
            'user', 'user__section', 'cabinet_session', 'photo',
        ).order_by('-access_time', '-pk')
        paginator = PageNumberPagination()
        paginator.page_size = 20
        paginator.page_size_query_param = 'page_size'
        paginator.max_page_size = 100
        page = paginator.paginate_queryset(logs, request, view=self)
        serializer = AccessLogSerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=['get'], url_path='profile-details')
    def profile_details(self, request, pk=None):
        profile_user = self.get_object()
        access_logs = AccessLog.objects.filter(user=profile_user).select_related(
            'user', 'user__section', 'cabinet_session', 'photo',
        ).order_by('-access_time', '-pk')
        activities = self._profile_activities(profile_user)
        submissions = Submission.objects.filter(student=profile_user).select_related('student', 'activity').order_by('-submitted_at', '-pk')

        return Response({
            'counts': {
                'access_logs': access_logs.count(),
                'activities': activities.count(),
                'submissions': submissions.count(),
            },
            'access_logs': AccessLogSerializer(access_logs[:5], many=True, context={'request': request}).data,
            'activities': ActivitySerializer(activities[:5], many=True, context={'request': request}).data,
            'submissions': SubmissionSerializer(submissions[:5], many=True, context={'request': request}).data,
        })

    @action(detail=True, methods=['get'], url_path='activities')
    def user_activities(self, request, pk=None):
        profile_user = self.get_object()
        activities = self._profile_activities(profile_user)
        paginator = PageNumberPagination()
        paginator.page_size = 20
        paginator.page_size_query_param = 'page_size'
        paginator.max_page_size = 100
        page = paginator.paginate_queryset(activities, request, view=self)
        serializer = ActivitySerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=['get'], url_path='submissions')
    def user_submissions(self, request, pk=None):
        profile_user = self.get_object()
        submissions = Submission.objects.filter(student=profile_user).select_related('student', 'activity').order_by('-submitted_at', '-pk')
        paginator = PageNumberPagination()
        paginator.page_size = 20
        paginator.page_size_query_param = 'page_size'
        paginator.max_page_size = 100
        page = paginator.paginate_queryset(submissions, request, view=self)
        serializer = SubmissionSerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=False, methods=['patch'])
    def update_profile(self, request):
        user = request.user
        serializer = self.get_serializer(user, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)

        allowed_fields = {'email', 'contact_number'}
        if user.role == User.RoleChoices.INSTRUCTOR:
            allowed_fields.update({'first_name', 'last_name', 'instructor_id', 'username'})
        validated_data = {k: v for k, v in serializer.validated_data.items() if k in allowed_fields}

        if validated_data:
            for key, value in validated_data.items():
                setattr(user, key, value)
            user.save()

        response_serializer = self.get_serializer(user, context={'request': request})
        return Response(response_serializer.data)

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_profile_image(self, request):
        user = request.user

        profile_image = request.FILES.get('profile_image')
        if not profile_image:
            return Response({'detail': 'A profile image is required.'}, status=status.HTTP_400_BAD_REQUEST)

        if profile_image.size > 5 * 1024 * 1024:
            return Response({'detail': 'Image must be 5 MB or smaller.'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_types = ['image/jpeg', 'image/jpg', 'image/png']
        if profile_image.content_type not in allowed_types:
            return Response({'detail': 'Only JPG, JPEG, and PNG images are allowed.'}, status=status.HTTP_400_BAD_REQUEST)

        user.profile_image = profile_image
        user.save()
        serializer = self.get_serializer(user, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def remove_profile_image(self, request):
        user = request.user
        user.profile_image.delete(save=False)
        user.profile_image = None
        user.save()
        serializer = self.get_serializer(user, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def change_password(self, request):
        user = request.user
        serializer = PasswordChangeSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        return Response({'detail': 'Password updated successfully.'}, status=status.HTTP_200_OK)

    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['role', 'section', 'is_active']
    search_fields = ['id', 'student_id', 'username', 'first_name', 'last_name', 'email']
    ordering_fields = ['id', 'student_id', 'username', 'first_name', 'last_name', 'created_at']
    ordering = ['id']


def get_instructor_notification_recipients_for_student(student):
    instructors = set()
    if student.section and student.section.instructor and student.section.instructor.role == User.RoleChoices.INSTRUCTOR:
        instructors.add(student.section.instructor)

    return instructors


def create_notification(
    instructor,
    title,
    message,
    notification_type,
    notification_key,
    link=''
):
    if not instructor:
        return None

    try:
        return Notification.objects.create(
            instructor=instructor,
            title=title,
            message=message,
            notification_type=notification_type,
            notification_key=notification_key,
            link=link,
        )
    except Exception:
        return None


def create_student_notification(student, title, message, notification_type, notification_key, link=''):
    if not student or student.role != User.RoleChoices.STUDENT:
        return None
    try:
        return Notification.objects.create(
            student=student,
            title=title,
            message=message,
            notification_type=notification_type,
            notification_key=notification_key,
            link=link,
        )
    except Exception:
        return None


def get_activity_students(activity):
    section_ids = set()
    if activity.section_id:
        section_ids.add(activity.section_id)
    section_ids.update(activity.assigned_sections.values_list('section_id', flat=True))
    return User.objects.filter(role=User.RoleChoices.STUDENT, section_id__in=section_ids).distinct()


def student_can_access_activity(student, activity):
    if (
        student.role != User.RoleChoices.STUDENT
        or not student.section_id
        or str(activity.status or '').casefold() != Activity.StatusChoices.PUBLISHED.casefold()
    ):
        return False
    return (
        activity.section_id == student.section_id
        or activity.assigned_sections.filter(pk=student.section_id).exists()
    )


def create_submission_notifications(submission):
    activity = submission.activity
    student = submission.student
    title = 'New submission received'
    if submission.attempt > 1:
        title = 'Activity resubmitted'
        notification_type = Notification.TypeChoices.RESUBMISSION
        message = f"{student.first_name} {student.last_name} resubmitted '{activity.title}'."
    else:
        notification_type = Notification.TypeChoices.SUBMISSION
        message = f"{student.first_name} {student.last_name} submitted '{activity.title}'."

    key = f"{notification_type}-{submission.id}"
    link = f"/instructor/submissions"

    if activity.created_by and activity.created_by.role == User.RoleChoices.INSTRUCTOR:
        create_notification(
            activity.created_by,
            title,
            message,
            notification_type,
            f"{key}-{activity.created_by.id}",
            link,
        )

    for instructor in get_instructor_notification_recipients_for_student(student):
        if activity.created_by and instructor.id == activity.created_by.id:
            continue
        create_notification(
            instructor,
            title,
            message,
            notification_type,
            f"{key}-{instructor.id}",
            link,
        )

    create_student_notification(
        student,
        'Submission received',
        f"Your submission for '{activity.title}' was received.",
        Notification.TypeChoices.SUBMISSION,
        f'student-submission-{submission.id}',
        '/student/submissions',
    )


def create_access_log_notifications(access_log):
    user = access_log.user
    if not user or user.role != User.RoleChoices.STUDENT:
        return

    instructors = get_instructor_notification_recipients_for_student(user)
    if not instructors:
        return

    title = 'Cabinet access log'
    status_text = 'successful' if access_log.status == AccessLog.AccessStatusChoices.SUCCESS else 'failed'
    message = f"{user.first_name} {user.last_name} had a {status_text} cabinet access event."
    link = '/instructor/access-logs'
    key_template = f"access-log-{access_log.id}"
    for instructor in instructors:
        create_notification(
            instructor,
            title,
            message,
            Notification.TypeChoices.ACCESS_LOG,
            f"{key_template}-{instructor.id}",
            link,
        )


def create_activity_notification(activity):
    if not activity or not activity.created_by or activity.created_by.role != User.RoleChoices.INSTRUCTOR:
        return

    instructor = activity.created_by
    title = 'New activity created'
    message = f"You created a new activity: '{activity.title}'."
    link = '/instructor/activities'
    key = f"activity-created-{activity.id}-{instructor.id}"

    create_notification(
        instructor,
        title,
        message,
        Notification.TypeChoices.DEADLINE,
        key,
        link,
    )


def create_deadline_notifications_for_instructor(instructor):
    now = timezone.now()
    soon = now + timedelta(hours=24)
    activities = Activity.objects.filter(created_by=instructor, due_date__gt=now, due_date__lte=soon)
    for activity in activities:
        key = f"deadline-{activity.id}-{instructor.id}"
        message = f"The deadline for '{activity.title}' is approaching."
        create_notification(
            instructor,
            'Deadline approaching',
            message,
            Notification.TypeChoices.DEADLINE,
            key,
            '/instructor/activities',
        )


class ActivityFilter(filters.FilterSet):
    section = filters.NumberFilter(method='filter_section')
    status = filters.CharFilter(method='filter_status')

    class Meta:
        model = Activity
        fields = ['section', 'status']

    def filter_status(self, queryset, name, value):
        value = str(value or '').lower().strip()
        user = getattr(self.request, 'user', None)
        now = timezone.now()
        submission_ids = Submission.objects.filter(activity__in=queryset, student=user).values_list('activity_id', flat=True)

        if value == 'pending':
            return queryset.exclude(id__in=submission_ids).filter(due_date__gte=now)
        if value == 'submitted':
            return queryset.filter(
                id__in=submission_ids,
                submissions__student=user,
                submissions__score__isnull=True,
                submissions__submitted_at__lte=models.F('due_date')
            ).distinct()
        if value == 'graded':
            return queryset.filter(id__in=submission_ids, submissions__student=user, submissions__score__isnull=False).distinct()
        if value == 'overdue':
            return queryset.exclude(id__in=submission_ids).filter(due_date__lt=now)
        return queryset

    def filter_section(self, queryset, name, value):
        return queryset.filter(Q(section_id=value) | Q(assigned_sections__section_id=value)).distinct()


class ActivityViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Activities.
    - Admins can view all activities
    - Instructors can create activities and manage only their own
    - Django superusers retain maintenance access
    - Students can view activities
    """
    authentication_classes = [JWTAuthentication]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = ActivityFilter
    search_fields = ['title', 'description', 'created_by__first_name', 'created_by__last_name']
    ordering_fields = ['created_at', 'due_date', 'title']
    ordering = ['-created_at']
    serializer_class = ActivitySerializer
    pagination_class = PageNumberPagination

    def _attach_assigned_instructor_names(self, response):
        data = response.data
        activities = data['results'] if isinstance(data, dict) and isinstance(data.get('results'), list) else [data]
        instructor_ids = {
            activity.get('assigned_instructor')
            for activity in activities
            if activity.get('assigned_instructor')
        }
        instructor_names = {
            instructor.pk: instructor.get_full_name().strip() or instructor.username
            for instructor in User.objects.filter(pk__in=instructor_ids, role=User.RoleChoices.INSTRUCTOR)
        }
        for activity in activities:
            instructor_id = activity.get('assigned_instructor')
            activity['assigned_instructor_name'] = instructor_names.get(instructor_id)
        return response

    def list(self, request, *args, **kwargs):
        return self._attach_assigned_instructor_names(super().list(request, *args, **kwargs))

    def retrieve(self, request, *args, **kwargs):
        return self._attach_assigned_instructor_names(super().retrieve(request, *args, **kwargs))

    def get_queryset(self):
        user = self.request.user
        base_qs = Activity.objects.select_related('created_by', 'section').prefetch_related('attachments')
        assigned_students = User.objects.filter(
            role=User.RoleChoices.STUDENT,
        ).filter(
            Q(section_id=models.OuterRef('section_id'))
            | Q(section__assigned_activities=models.OuterRef('pk')),
        ).order_by().values('role').annotate(
            total=models.Count('pk', distinct=True),
        ).values('total')[:1]
        annotated_qs = base_qs.annotate(
            submitted_students_count=models.Count('submissions__student', distinct=True),
            assigned_student_count=models.functions.Coalesce(
                models.Subquery(assigned_students, output_field=models.IntegerField()),
                models.Value(0),
            ),
        )

        if user.role == 'admin':
            return annotated_qs
        elif user.role == 'instructor':
            section_id = self.request.query_params.get('section')
            if section_id:
                section = Section.objects.filter(pk=section_id).filter(
                    models.Q(instructor=user) | models.Q(assigned_instructors=user)
                ).first()
                if not section:
                    return Activity.objects.none()
                return annotated_qs.filter(
                    models.Q(section=section) | models.Q(assigned_sections=section)
                ).distinct()
            return annotated_qs.filter(created_by=user)
        elif user.role == 'student':
            # Return activities assigned to the student's section. Do not
            # exclude submitted activities here — the frontend can filter
            # by status when needed. If the student has no section, return
            # an empty queryset.
            if not user.section:
                return Activity.objects.none()
            return annotated_qs.filter(
                Q(section=user.section) | Q(assigned_sections=user.section),
            ).filter(status__iexact=Activity.StatusChoices.PUBLISHED).distinct()
        return Activity.objects.none()

    @action(detail=False, methods=['get'])
    def stats(self, request):
        user = request.user
        if user.role != 'student':
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        assigned_qs = Activity.objects.filter(
            Q(section=user.section) | Q(assigned_sections=user.section),
            status__iexact=Activity.StatusChoices.PUBLISHED,
        ).distinct() if user.section else Activity.objects.none()
        submission_qs = Submission.objects.filter(student=user)
        submitted_activity_ids = submission_qs.values_list('activity_id', flat=True).distinct()
        now = timezone.now()

        total_activities = assigned_qs.count()
        submitted_activities = submitted_activity_ids.count()
        pending_activities = assigned_qs.exclude(id__in=submitted_activity_ids).filter(
            models.Q(due_date__gte=now) | models.Q(due_date__isnull=True)
        ).count()
        overdue_activities = assigned_qs.exclude(id__in=submitted_activity_ids).filter(due_date__lt=now).count()

        return Response({
            'total_activities': total_activities,
            'pending_activities': pending_activities,
            'submitted_activities': submitted_activities,
            'overdue_activities': overdue_activities,
        })

    def get_permissions(self):
        if self.action == 'list' or self.action == 'retrieve' or self.action == 'stats':
            return [IsAuthenticated()]
        elif self.action in ['create', 'update', 'partial_update', 'destroy', 'delete_attachment']:
            return [IsAuthenticated(), IsInstructorOrSuperuser()]
        else:
            return [IsAuthenticated(), IsAdminRole()]

    def perform_create(self, serializer):
        self._validate_instructor_activity_sections(serializer)
        activity = serializer.save(created_by=self.request.user)
        if activity.status == Activity.StatusChoices.PUBLISHED:
            for student in get_activity_students(activity):
                create_student_notification(
                    student,
                    'New activity assigned',
                    f'New activity available: {activity.title}.',
                    Notification.TypeChoices.ACTIVITY,
                    f'activity-created-{activity.id}-{student.id}',
                    '/student/activities',
                )

    def perform_update(self, serializer):
        self._validate_instructor_activity_sections(serializer)
        activity = serializer.save()
        if activity.status == Activity.StatusChoices.PUBLISHED:
            for student in get_activity_students(activity):
                create_student_notification(
                    student,
                    'Activity updated',
                    f'{activity.title} has been updated by your instructor.',
                    Notification.TypeChoices.ACTIVITY,
                    f'activity-update-{activity.id}-{student.id}-{activity.updated_at.isoformat()}',
                    '/student/activities',
                )

    def _validate_instructor_activity_sections(self, serializer):
        user = self.request.user
        if user.role != User.RoleChoices.INSTRUCTOR:
            return

        requested_sections = set()
        section = serializer.validated_data.get('section')
        if section:
            requested_sections.add(section.pk)
        assigned_sections = serializer.validated_data.get('assigned_sections', [])
        requested_sections.update(item.pk for item in assigned_sections)
        if not requested_sections:
            return

        allowed_sections = set(Section.objects.filter(
            pk__in=requested_sections,
        ).filter(
            Q(instructor=user) | Q(assigned_instructors=user),
        ).values_list('pk', flat=True))
        if allowed_sections != requested_sections:
            raise serializers.ValidationError({
                'assigned_sections': 'You can only assign activities to your assigned sections.'
            })

    @action(
        detail=True,
        methods=['delete'],
        url_path=r'attachments/(?P<attachment_id>[^/.]+)',
    )
    def delete_attachment(self, request, pk=None, attachment_id=None):
        activity = self.get_object()
        attachment = get_object_or_404(
            ActivityAttachment,
            id=attachment_id,
            activity=activity,
        )
        if attachment.file:
            attachment.file.delete(save=False)
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def diagnostics(self, request):
        """Temporary diagnostic endpoint: lists activities with latest submission
        info for the authenticated student. Returns: activity id, title,
        latest_submission_id, has_file, has_attachments, submitted_at, score,
        serializer_computed_status. Remove this endpoint after debugging.
        """
        user = request.user
        if not user or user.role != 'student':
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        activities = Activity.objects.filter(section=user.section).order_by('due_date') if user.section else Activity.objects.none()
        results = []
        for a in activities:
            sub = Submission.objects.filter(activity=a, student=user).order_by('-submitted_at').first()
            if not sub:
                results.append({
                    'activity_id': a.id,
                    'title': a.title,
                    'latest_submission_id': None,
                    'has_file': False,
                    'has_attachments': False,
                    'submitted_at': None,
                    'score': None,
                    'computed_status': ActivitySerializer(a, context={'request': request}).data.get('student_submission_status')
                })
                continue

            try:
                has_attachments = sub.attachments.exists()
            except Exception:
                has_attachments = False

            results.append({
                'activity_id': a.id,
                'title': a.title,
                'latest_submission_id': sub.id,
                'has_file': bool(sub.file),
                'has_attachments': has_attachments,
                'submitted_at': sub.submitted_at,
                'score': sub.score,
                'computed_status': ActivitySerializer(a, context={'request': request}).data.get('student_submission_status')
            })

        return Response({'results': results})


class ActivityDiscussionViewSet(viewsets.ModelViewSet):
    """Discussion messages for activities. Students and instructors can
    list and create messages for activities they are part of.
    """
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsDiscussionAuthorOrInstructor]
    serializer_class = ActivityDiscussionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [filters.DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['activity']
    ordering_fields = ['created_at', 'id']
    ordering = ['created_at', 'id']

    def _authorized_activities(self, user):
        if user.role == User.RoleChoices.ADMIN:
            return Activity.objects.all()
        if user.role == User.RoleChoices.INSTRUCTOR:
            return Activity.objects.filter(
                Q(created_by=user)
                | Q(section__instructor=user)
                | Q(section__assigned_instructors=user)
                | Q(assigned_sections__instructor=user)
                | Q(assigned_sections__assigned_instructors=user)
            ).distinct()
        if user.role == User.RoleChoices.STUDENT and user.section_id:
            return Activity.objects.filter(
                Q(section_id=user.section_id) | Q(assigned_sections__section_id=user.section_id),
                status__iexact=Activity.StatusChoices.PUBLISHED,
            ).distinct()
        return Activity.objects.none()

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return ActivityDiscussion.objects.none()
        return ActivityDiscussion.objects.filter(
            activity__in=self._authorized_activities(user),
        ).select_related('sender', 'activity').prefetch_related('attachments').order_by('created_at', 'pk')

    def perform_create(self, serializer):
        user = self.request.user
        activity = serializer.validated_data.get('activity')
        if not activity or not self._authorized_activities(user).filter(pk=activity.pk).exists():
            raise PermissionDenied('You cannot discuss an activity you are not authorized to view.')
        role = getattr(user, 'role', '')
        discussion = serializer.save(sender=user, sender_role=role, activity=activity)
        if user.role == User.RoleChoices.INSTRUCTOR:
            for student in get_activity_students(discussion.activity):
                create_student_notification(
                    student,
                    'New instructor comment',
                    f"{user.get_full_name() or user.username} commented on {discussion.activity.title}.",
                    Notification.TypeChoices.FEEDBACK,
                    f'discussion-{discussion.id}-{student.id}',
                    '/student/activities',
                )

    def perform_update(self, serializer):
        instance = serializer.instance
        next_activity = serializer.validated_data.get('activity', instance.activity)
        if next_activity.pk != instance.activity_id:
            raise PermissionDenied('Discussion messages cannot be moved to another activity.')
        serializer.save()

    def perform_destroy(self, instance):
        for attachment in instance.attachments.all():
            if attachment.file:
                attachment.file.delete(save=False)
        instance.delete()


class ActivityAnnouncementViewSet(viewsets.ModelViewSet):
    """Announcements for an activity created by instructors."""
    authentication_classes = [JWTAuthentication]
    serializer_class = ActivityAnnouncementSerializer
    filter_backends = [filters.DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['activity']
    ordering_fields = ['created_at', 'is_pinned']
    ordering = ['-is_pinned', '-created_at']

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return ActivityAnnouncement.objects.none()
        queryset = ActivityAnnouncement.objects.select_related('created_by', 'activity')
        if user.role == 'admin':
            return queryset
        if user.role == 'instructor':
            return queryset.filter(activity__section__instructor=user)
        if user.role == 'student':
            if not user.section:
                return ActivityAnnouncement.objects.none()
            return queryset.filter(
                Q(activity__section=user.section) | Q(activity__assigned_sections=user.section),
                activity__status__iexact=Activity.StatusChoices.PUBLISHED,
            ).distinct()
        return ActivityAnnouncement.objects.none()

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsInstructorRole()]

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user)
        for student in get_activity_students(announcement.activity):
            create_student_notification(
                student,
                announcement.title or 'Activity announcement',
                announcement.message,
                Notification.TypeChoices.ANNOUNCEMENT,
                f'announcement-{announcement.id}-{student.id}',
                '/student/activities',
            )

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.delete()

    @action(detail=True, methods=['post'])
    def toggle_pin(self, request, pk=None):
        announcement = self.get_object()
        announcement.is_pinned = not announcement.is_pinned
        announcement.save(update_fields=['is_pinned'])
        return Response(self.get_serializer(announcement).data)

    @action(detail=True, methods=['post'])
    def toggle_update(self, request, pk=None):
        announcement = self.get_object()
        announcement.is_update = not announcement.is_update
        announcement.save(update_fields=['is_update'])
        return Response(self.get_serializer(announcement).data)

    def get_serializer(self, *args, **kwargs):
        kwargs.setdefault('context', {}).update({'request': self.request})
        return super().get_serializer(*args, **kwargs)

    @action(detail=True, methods=['get'])
    def submissions(self, request, pk=None):
        """Get submissions for this activity"""
        activity = self.get_object()
        submissions = activity.submissions.all()
        serializer = SubmissionSerializer(submissions, many=True)
        return Response(serializer.data)


class SubmissionFilter(filters.FilterSet):
    status = filters.CharFilter(method='filter_status', field_name='status')
    activity = filters.ModelChoiceFilter(field_name='activity', queryset=Activity.objects.all())
    student__section = filters.ModelChoiceFilter(field_name='student__section', queryset=Section.objects.all())
    activity__created_by = filters.ModelChoiceFilter(field_name='activity__created_by', queryset=User.objects.filter(role=User.RoleChoices.INSTRUCTOR))
    submitted_at = filters.DateFromToRangeFilter(field_name='submitted_at')
    submission_date = filters.DateFilter(method='filter_submission_date')

    class Meta:
        model = Submission
        fields = ['activity', 'student__section', 'submitted_at']

    def filter_status(self, queryset, name, value):
        value = str(value).lower().strip()
        if value == 'graded':
            return queryset.filter(score__isnull=False)
        if value in ('submitted', 'under_review'):
            return queryset.annotate(
                _trimmed_feedback=models.functions.Trim('feedback'),
            ).filter(
                score__isnull=True,
                _trimmed_feedback='',
            ).exclude(activity__due_date__lt=models.F('submitted_at'))
        if value == 'returned_for_revision':
            return queryset.annotate(
                _trimmed_feedback=models.functions.Trim('feedback'),
            ).filter(score__isnull=True, _trimmed_feedback__gt='')
        if value == 'late':
            return queryset.annotate(
                _trimmed_feedback=models.functions.Trim('feedback'),
            ).filter(
                score__isnull=True,
                _trimmed_feedback='',
                activity__due_date__lt=models.F('submitted_at'),
            )
        if value == 'missing':
            return queryset.filter(score__isnull=True, activity__due_date__lt=timezone.now(), submitted_at__isnull=True)
        return queryset

    def filter_submission_date(self, queryset, name, value):
        start = datetime.combine(value, time.min, tzinfo=ZoneInfo('Asia/Manila'))
        return queryset.filter(submitted_at__gte=start, submitted_at__lt=start + timedelta(days=1))


class SubmissionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Submissions.
    - Students can create submissions
    - Instructors can view submissions for their activities and grade them
    - Admins can view all submissions
    """
    serializer_class = SubmissionSerializer
    authentication_classes = [JWTAuthentication]
    parser_classes = (JSONParser, MultiPartParser, FormParser)
    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = SubmissionFilter
    search_fields = ['student__first_name', 'student__last_name', 'student__student_id', 'activity__title']
    ordering_fields = ['submitted_at', 'score', 'activity__title', 'student__student_id']
    ordering = ['-submitted_at']
    pagination_class = PageNumberPagination

    def _instructor_submission_filters(self):
        user = self.request.user
        filters = (
            Q(activity__created_by=user)
            | Q(student__section__instructor=user)
            | Q(student__section__assigned_instructors=user)
        )
        return filters

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return Submission.objects.all()
        elif user.role == 'instructor':
            section_id = self.request.query_params.get('section') or self.request.query_params.get('student__section')
            if section_id:
                section = Section.objects.filter(pk=section_id).filter(
                    Q(instructor=user) | Q(assigned_instructors=user)
                ).first()
                if not section:
                    return Submission.objects.none()
                section_activities = Activity.objects.filter(
                    Q(section=section) | Q(assigned_sections=section)
                )
                return Submission.objects.filter(
                    student__role=User.RoleChoices.STUDENT,
                    student__section=section,
                    activity__in=section_activities,
                ).select_related('student', 'activity').distinct()
            return Submission.objects.filter(self._instructor_submission_filters()).select_related('student', 'activity').distinct()
        elif user.role == 'student':
            return Submission.objects.filter(student=user).exclude(
                activity__status__iexact=Activity.StatusChoices.DRAFT,
            ).select_related('activity')
        else:
            return Submission.objects.none()

    def _is_instructor_authorized_for_submission(self, submission):
        user = self.request.user
        if submission.activity.created_by == user:
            return True

        if submission.student and submission.student.section:
            return (
                submission.student.section.instructor == user
                or submission.student.section.assigned_instructors.filter(pk=user.pk).exists()
            )

        return False

    def get_permissions(self):
        if self.action == 'create':
            return [IsAuthenticated(), IsStudentRole()]
        elif self.action in ['update', 'partial_update']:
            return [IsAuthenticated()]
        elif self.action in ['destroy', 'grade']:
            return [IsAuthenticated(), IsInstructorOrSuperuser()]
        elif self.action == 'stats':
            return [IsAuthenticated()]
        else:
            return [IsAuthenticated()]

    def perform_create(self, serializer):
        student = self.request.user
        if any(field in self.request.data for field in ('score', 'feedback')):
            raise serializers.ValidationError('Students cannot set grades or instructor feedback.')
        activity = serializer.validated_data.get('activity')
        if activity is None:
            raise serializers.ValidationError({'activity': 'Activity is required.'})
        self._validate_student_submission_activity(activity, student)
        self._validate_student_temporary_uploads(activity, student)

        last_attempt = Submission.objects.filter(activity=activity, student=student).order_by('-attempt').first()
        submission = serializer.save(student=student, attempt=(last_attempt.attempt + 1 if last_attempt else 1))
        create_submission_notifications(submission)

    def perform_update(self, serializer):
        user = self.request.user
        submission = serializer.instance
        if user.role == User.RoleChoices.STUDENT:
            if any(field in self.request.data for field in ('score', 'feedback')):
                raise serializers.ValidationError('Students cannot set grades or instructor feedback.')
            if submission.student_id != user.pk:
                raise PermissionDenied('You can only edit your own submission.')
            if serializer.validated_data.get('activity', submission.activity) != submission.activity:
                raise PermissionDenied('A submission cannot be moved to another activity.')
            self._validate_student_submission_activity(submission.activity, user)
            self._validate_student_temporary_uploads(submission.activity, user)
        elif user.role == User.RoleChoices.INSTRUCTOR:
            if not self._is_instructor_authorized_for_submission(submission):
                raise PermissionDenied('You cannot edit a submission outside your assigned activities or sections.')
        elif not user.is_superuser:
            raise PermissionDenied('Only the student owner, authorized instructor, or Django superuser can edit this submission.')
        serializer.save()

    @staticmethod
    def _validate_student_submission_activity(activity, student):
        if not student_can_access_activity(student, activity):
            raise PermissionDenied('You can only submit to activities assigned to your section.')
        if str(activity.status or '').lower() in ('closed', 'archived'):
            raise PermissionDenied('This activity is closed for submissions.')
        if activity.due_date and activity.due_date < timezone.now() and not activity.allow_resubmission:
            raise PermissionDenied('The deadline has passed and late submissions are not allowed.')

    def _validate_student_temporary_uploads(self, activity, student):
        request_data = self.request.data
        if hasattr(request_data, 'getlist'):
            raw_ids = request_data.getlist('temp_upload_ids')
        else:
            raw_ids = request_data.get('temp_upload_ids', [])
        if raw_ids in (None, ''):
            return
        if not isinstance(raw_ids, (list, tuple, set)):
            raw_ids = [raw_ids]
        try:
            upload_ids = {int(upload_id) for upload_id in raw_ids if str(upload_id).strip()}
        except (TypeError, ValueError):
            raise serializers.ValidationError({'temp_upload_ids': 'Uploaded file identifiers must be integers.'})
        if not upload_ids:
            return

        uploads = list(TemporaryUpload.objects.filter(pk__in=upload_ids, user=student))
        if len(uploads) != len(upload_ids) or any(
            upload.activity_id not in (None, activity.pk)
            for upload in uploads
        ):
            raise serializers.ValidationError({
                'temp_upload_ids': 'One or more uploaded files do not belong to this activity.'
            })

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return submissions summary counts for the current user.

        Response keys are shaped for the frontend: `totalSubmissions`,
        `pendingReview`, `graded`, `lateSubmissions`.
        """
        user = request.user
        if user.role not in ('admin', 'instructor', 'student'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        base_qs = self.filter_queryset(self.get_queryset())

        summary_qs = base_qs.annotate(_trimmed_feedback=models.functions.Trim('feedback'))
        total = summary_qs.count()
        graded = summary_qs.filter(score__isnull=False).count()
        pending = summary_qs.filter(score__isnull=True).count()
        under_review = summary_qs.filter(score__isnull=True, _trimmed_feedback='').exclude(
            activity__due_date__lt=models.F('submitted_at'),
        ).count()
        returned_for_revision = summary_qs.filter(
            score__isnull=True,
            _trimmed_feedback__gt='',
        ).count()
        late = summary_qs.filter(
            score__isnull=True,
            _trimmed_feedback='',
            activity__due_date__lt=models.F('submitted_at'),
        ).count()

        return Response({
            'totalSubmissions': total,
            'pendingReview': pending,
            'underReview': under_review,
            'returnedForRevision': returned_for_revision,
            'graded': graded,
            'lateSubmissions': late,
        })

    @action(detail=True, methods=['post'])
    def grade(self, request, pk=None):
        """Grade a submission and update the existing record in place."""
        submission = self.get_object()

        if request.user.role == 'instructor' and not self._is_instructor_authorized_for_submission(submission):
            return Response(
                {'detail': 'Permission denied. You can only grade submissions for your activities or assigned sections.'},
                status=status.HTTP_403_FORBIDDEN
            )
        if request.user.role != 'instructor' and not request.user.is_superuser:
            return Response(
            {'detail': 'Only instructors and Django superusers can grade submissions.'},
                status=status.HTTP_403_FORBIDDEN
            )

        score = request.data.get('score')
        feedback = request.data.get('feedback', '')

        if score in [None, '']:
            return Response(
                {'detail': 'Score is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            score = float(score)
        except (ValueError, TypeError):
            return Response(
                {'detail': 'Score must be a valid number.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if score < 0:
            return Response(
                {'detail': 'Score cannot be negative.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        max_score = getattr(submission.activity, 'max_score', None)
        if max_score is not None and score > float(max_score):
            return Response(
                {'detail': f'Score cannot exceed the activity maximum score of {max_score}.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            submission.score = score
            submission.feedback = feedback or ''
            submission.graded_by = request.user
            submission.graded_at = timezone.now()
            submission.save(update_fields=['score', 'feedback', 'graded_by', 'graded_at', 'updated_at'])
            submission.refresh_from_db()
            create_student_notification(
                submission.student,
                'Submission graded',
                f"Your submission for '{submission.activity.title}' has been graded." + (f' Feedback: {feedback}' if feedback else ''),
                Notification.TypeChoices.GRADE,
                f'grade-{submission.id}-{submission.updated_at.isoformat()}',
                '/student/submissions',
            )
            serializer = self.get_serializer(submission)
            return Response(serializer.data)
        except Exception as exc:
            logger = getattr(self, 'logger', None)
            if logger is not None:
                logger.exception('Failed to grade submission %s', submission.id)
            else:
                import logging
                logging.getLogger('django.request').exception('Failed to grade submission %s', submission.id)
            return Response(
                {'detail': f'Failed to save grade: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class TemporaryUploadViewSet(viewsets.ModelViewSet):
    """Endpoint for students to upload temporary files (drafts).

    - POST to create a TemporaryUpload with the file in 'file' form field.
    - GET to list temporary uploads for the current user.
    - DELETE to remove a temporary upload.
    """
    serializer_class = None
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        return TemporaryUpload.objects.filter(user=self.request.user)

    def list(self, request, *args, **kwargs):
        uploads = self.get_queryset()
        data = [
            {
                'id': up.id,
                'name': up.original_filename or up.file.name.split('/')[-1],
                'size': up.file_size or (up.file.size if hasattr(up.file, 'size') else None),
                'content_type': up.content_type,
                'uploaded_at': up.uploaded_at,
                'url': None,
            }
            for up in uploads
        ]
        return Response(data)

    def create(self, request, *args, **kwargs):
        file = request.FILES.get('file')
        activity_id = request.data.get('activity')
        activity = None
        if activity_id:
            try:
                activity = Activity.objects.get(pk=activity_id)
            except Activity.DoesNotExist:
                activity = None
        if not file:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)
        uploads, upload_errors, error_status = store_student_temporary_uploads(
            request.user, activity, [file], request.data,
        )
        if upload_errors:
            return Response(upload_errors, status=error_status)
        up = uploads[0]
        data = {
            'id': up.id,
            'name': up.original_filename or up.file.name.split('/')[-1],
            'size': up.file_size,
            'content_type': up.content_type,
            'uploaded_at': up.uploaded_at,
            'url': None,
        }
        return Response(data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None, *args, **kwargs):
        up = self.get_queryset().filter(pk=pk).first()
        if not up:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        up.file.delete(save=False)
        up.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudentSubmissionUpload(APIView):
    """Dedicated endpoint for student temp uploads: POST /api/student/submissions/upload"""
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStudentRole]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        files = request.FILES.getlist('files') or []
        activity_id = request.data.get('activity')
        if not activity_id:
            return Response({'activity': 'Activity is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            activity = Activity.objects.get(pk=activity_id)
        except (Activity.DoesNotExist, ValueError, TypeError):
            return Response({'activity': 'Activity was not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not student_can_access_activity(request.user, activity):
            return Response({'detail': 'You cannot upload files for an activity outside your section.'}, status=status.HTTP_404_NOT_FOUND)

        if not files:
            # also allow single file field 'file'
            single = request.FILES.get('file')
            if single:
                files = [single]

        if not files:
            return Response({'detail': 'No files uploaded.'}, status=status.HTTP_400_BAD_REQUEST)

        existing_files, removal_errors = get_existing_submission_files_for_upload(
            request.user, activity, request.data,
        )
        if removal_errors:
            return Response(removal_errors, status=status.HTTP_400_BAD_REQUEST)
        existing_files.extend(
            upload.file
            for upload in TemporaryUpload.objects.filter(user=request.user, activity=activity)
        )
        upload_errors = validate_student_submission_files(files, existing_files)
        if upload_errors:
            return Response({'files': upload_errors}, status=status.HTTP_400_BAD_REQUEST)

        uploads = create_temporary_uploads(request.user, activity, files)
        for upload, uploaded_file in zip(uploads, files):
            upload.original_filename = os.path.basename(str(uploaded_file.name or '').replace('\\', '/'))[:255]
            upload.file_size = int(uploaded_file.size)
            upload.content_type = str(uploaded_file.content_type or '')
            upload.save(update_fields=['original_filename', 'file_size', 'content_type'])
        results = [
            {
                'id': up.id,
                'name': up.original_filename or up.file.name.split('/')[-1],
                'size': up.file_size,
                'content_type': up.content_type,
                'uploaded_at': up.uploaded_at,
                'url': None,
            }
            for up in uploads
        ]

        return Response({'uploads': results}, status=status.HTTP_201_CREATED)


class AccessLogFilter(filters.FilterSet):
    status = filters.CharFilter(method='filter_access_result')
    action = filters.CharFilter(field_name='action', lookup_expr='iexact')
    student_id = filters.CharFilter(field_name='user__student_id', lookup_expr='iexact')
    user__section = filters.ModelChoiceFilter(field_name='user__section', queryset=Section.objects.all())
    station = filters.CharFilter(field_name='station', lookup_expr='iexact')
    nfc_uid = filters.CharFilter(method='filter_nfc_uid')
    cabinet_name = filters.CharFilter(field_name='cabinet_name', lookup_expr='iexact')
    photo_capture_status = filters.CharFilter(field_name='photo__capture_status', lookup_expr='iexact')
    access_time = filters.DateFromToRangeFilter(field_name='access_time')

    class Meta:
        model = AccessLog
        fields = [
            'status', 'action', 'station', 'nfc_uid', 'student_id',
            'user__section', 'cabinet_name', 'photo_capture_status', 'access_time',
        ]

    def filter_access_result(self, queryset, name, value):
        result = str(value or '').strip().lower()
        request_user = getattr(getattr(self, 'request', None), 'user', None)
        if getattr(request_user, 'role', None) != User.RoleChoices.INSTRUCTOR:
            return queryset.filter(status__iexact=value)
        if result == 'success':
            return queryset.filter(status=AccessLog.AccessStatusChoices.SUCCESS)
        if result == 'failed':
            return queryset.exclude(status=AccessLog.AccessStatusChoices.SUCCESS)
        return queryset.filter(status__iexact=value)

    def filter_nfc_uid(self, queryset, name, value):
        request_user = getattr(getattr(self, 'request', None), 'user', None)
        if getattr(request_user, 'role', None) != User.RoleChoices.ADMIN:
            return queryset
        return queryset.filter(nfc_uid__icontains=value)


class AccessLogPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class AccessLogSearchFilter(SearchFilter):
    def get_search_fields(self, view, request):
        fields = super().get_search_fields(view, request)
        if request.user.role == User.RoleChoices.INSTRUCTOR:
            fields = [field for field in fields if 'nfc_uid' not in field]
            return [*fields, 'cabinet_name']
        if request.user.role == User.RoleChoices.STUDENT:
            return ['cabinet_name', 'reason', 'status']
        return fields


class CabinetWorkflowView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def get_context(self, request):
        context = getattr(request, 'nfc_device_context', {})
        if context.get('mock'):
            return context
        if not context.get('cabinet_name'):
            return None
        return context

    def active_session(self, station, lock=False):
        queryset = CabinetSession.objects.filter(station=station, status=CabinetSession.StatusChoices.OPEN)
        if lock:
            queryset = queryset.select_for_update()
        return queryset.order_by('-opened_at').first()

    def get(self, request, *args, **kwargs):
        context = self.get_context(request)
        if not context:
            return Response({'error': 'Reader device is not mapped to a cabinet.'}, status=status.HTTP_403_FORBIDDEN)
        if context.get('mock'):
            stations = []
            for station in settings.TAPTRACK_CABINET_STATIONS:
                session = self.active_session(station)
                stations.append({
                    'name': station,
                    'cabinet_name': settings.TAPTRACK_CABINET_NAME,
                    'status': 'occupied' if session else 'available',
                    'session': CabinetSessionSerializer(session).data if session else None,
                })
            return Response({'mode': 'mock', 'stations': stations})
        stations = []
        for station in settings.TAPTRACK_CABINET_STATIONS:
            session = self.active_session(station)
            stations.append({
                'name': station,
                'cabinet_name': context['cabinet_name'],
                'status': 'occupied' if session else 'available',
                'session': CabinetSessionSerializer(session).data if session else None,
            })
        return Response({
            'mode': 'hardware',
            'cabinet_name': context['cabinet_name'],
            'stations': stations,
        })

    def post(self, request, *args, **kwargs):
        context = self.get_context(request)
        if not context:
            return Response({'error': 'Reader device is not mapped to a cabinet.'}, status=status.HTTP_403_FORBIDDEN)

        station = str(request.data.get('station') or '').strip()
        if station not in settings.TAPTRACK_CABINET_STATIONS:
            return Response({'error': 'Select a configured cabinet station.'}, status=status.HTTP_400_BAD_REQUEST)
        if context.get('mock'):
            context = {**context, 'cabinet_name': settings.TAPTRACK_CABINET_NAME}
        context = {**context, 'station': station}

        command = str(request.data.get('command') or '').strip().lower()
        with transaction.atomic():
            session = self.active_session(station, lock=True)
            if command == 'open':
                another_workflow = CabinetSession.objects.filter(
                    station__in=settings.TAPTRACK_CABINET_STATIONS,
                    status=CabinetSession.StatusChoices.OPEN,
                    workflow_state__in=(
                        CabinetSession.WorkflowStateChoices.OPENING,
                        CabinetSession.WorkflowStateChoices.CLOSING,
                    ),
                ).exclude(station=station).exists()
                if another_workflow and not context.get('mock'):
                    return Response({'error': 'Another station is currently using the shared NFC reader.'}, status=status.HTTP_409_CONFLICT)
                if session:
                    return Response({'error': 'This station already has an active session.'}, status=status.HTTP_409_CONFLICT)
                try:
                    with transaction.atomic():
                        session = CabinetSession.objects.create(
                            station=context['station'],
                            status=CabinetSession.StatusChoices.OPEN,
                            workflow_state=CabinetSession.WorkflowStateChoices.OPENING,
                        )
                except IntegrityError:
                    return Response({'error': 'This station already has an active session.'}, status=status.HTTP_409_CONFLICT)
            elif command == 'finish_open':
                if not session or session.workflow_state != CabinetSession.WorkflowStateChoices.OPENING:
                    return Response({'error': 'There is no opening workflow to finish.'}, status=status.HTTP_409_CONFLICT)
                if not session.opened_by.exists():
                    return Response({'error': 'Scan at least one participant before opening.'}, status=status.HTTP_409_CONFLICT)
                session.workflow_state = CabinetSession.WorkflowStateChoices.IDLE
                session.save(update_fields=['workflow_state', 'updated_at'])
            elif command == 'start_close':
                if not session or session.workflow_state != CabinetSession.WorkflowStateChoices.IDLE:
                    return Response({'error': 'There is no active session available to close.'}, status=status.HTTP_409_CONFLICT)
                another_workflow = CabinetSession.objects.filter(
                    station__in=settings.TAPTRACK_CABINET_STATIONS,
                    status=CabinetSession.StatusChoices.OPEN,
                    workflow_state__in=(
                        CabinetSession.WorkflowStateChoices.OPENING,
                        CabinetSession.WorkflowStateChoices.CLOSING,
                    ),
                ).exclude(station=station).exists()
                if another_workflow and not context.get('mock'):
                    return Response({'error': 'Another station is currently using the shared NFC reader.'}, status=status.HTTP_409_CONFLICT)
                session.closed_by.clear()
                session.workflow_state = CabinetSession.WorkflowStateChoices.CLOSING
                session.save(update_fields=['workflow_state', 'updated_at'])
            elif command == 'finish_close':
                if not session or session.workflow_state != CabinetSession.WorkflowStateChoices.CLOSING:
                    return Response({'error': 'There is no closing workflow to finish.'}, status=status.HTTP_409_CONFLICT)
                if not session.closed_by.exists():
                    return Response({'error': 'Scan at least one participant before closing.'}, status=status.HTTP_409_CONFLICT)
                session.status = CabinetSession.StatusChoices.CLOSED
                session.workflow_state = CabinetSession.WorkflowStateChoices.IDLE
                session.closed_at = timezone.now()
                session.save(update_fields=['status', 'workflow_state', 'closed_at', 'updated_at'])
            elif command == 'cancel':
                if not session or session.workflow_state == CabinetSession.WorkflowStateChoices.IDLE:
                    return Response({'error': 'There is no active workflow to cancel.'}, status=status.HTTP_409_CONFLICT)
                if session.workflow_state == CabinetSession.WorkflowStateChoices.OPENING:
                    session.status = CabinetSession.StatusChoices.CLOSED
                    session.closed_at = timezone.now()
                    session.save(update_fields=['status', 'workflow_state', 'closed_at', 'updated_at'])
                else:
                    session.closed_by.clear()
                    session.workflow_state = CabinetSession.WorkflowStateChoices.IDLE
                    session.save(update_fields=['workflow_state', 'updated_at'])
            else:
                return Response({'error': 'Unsupported cabinet workflow command.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'mode': 'mock' if context.get('mock') else 'hardware',
            'station': context['station'],
            'cabinet_name': context['cabinet_name'],
            'session': CabinetSessionSerializer(session).data,
        })


class CabinetSessionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CabinetSession.objects.all()
    serializer_class = CabinetSessionSerializer
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'station', 'opened_by', 'closed_by']
    search_fields = ['station', 'opened_by__student_id', 'closed_by__student_id', 'notes']
    ordering_fields = ['opened_at', 'closed_at', 'station']
    ordering = ['-opened_at']
    pagination_class = AccessLogPagination

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.user.is_authenticated and request.user.role != User.RoleChoices.ADMIN:
            omit_response_fields(response.data, {'uid', 'nfc_uid'})
        return response

    @action(detail=False, methods=['get'], url_path='station-status')
    def station_status(self, request):
        station_names = list(dict.fromkeys(settings.TAPTRACK_CABINET_STATIONS))
        active_sessions = CabinetSession.objects.filter(
            status=CabinetSession.StatusChoices.OPEN,
            station__in=station_names,
        ).prefetch_related('opened_by').order_by('-opened_at')
        sessions_by_station = {}
        for session in active_sessions:
            sessions_by_station.setdefault(session.station, session)

        include_session_details = request.user.role in (User.RoleChoices.ADMIN, User.RoleChoices.INSTRUCTOR)
        stations = []
        for station in station_names:
            session = sessions_by_station.get(station)
            session_details = None
            if session and include_session_details:
                session_details = {
                    'id': session.pk,
                    'station': session.station,
                    'participant_count': session.opened_by.count(),
                    'opened_at': session.opened_at,
                }
            stations.append({
                'station': station,
                'status': 'OCCUPIED' if session else 'AVAILABLE',
                'active_session': session_details,
            })

        return Response({'stations': stations})

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return CabinetSession.objects.all()
        if user.role == 'instructor':
            assigned_student = Q(role=User.RoleChoices.STUDENT) & (
                Q(section__instructor=user) | Q(section__assigned_instructors=user)
            )
            return CabinetSession.objects.filter(
                Q(opened_by__in=User.objects.filter(assigned_student))
                | Q(closed_by__in=User.objects.filter(assigned_student))
                | Q(access_logs__user__in=User.objects.filter(assigned_student))
            ).distinct()
        if user.role == 'student':
            return CabinetSession.objects.filter(access_logs__user=user).distinct()
        return CabinetSession.objects.none()


class AccessLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for managing Access Logs.
    Returns latest access logs first with filtering by status, section, cabinet, and instructor-owned students.
    """
    queryset = AccessLog.objects.select_related('user', 'user__section', 'cabinet_session', 'photo').all()
    serializer_class = AccessLogSerializer
    authentication_classes = [JWTAuthentication]
    filter_backends = [filters.DjangoFilterBackend, AccessLogSearchFilter, OrderingFilter]
    filterset_class = AccessLogFilter
    search_fields = ['user__student_id', 'user__first_name', 'user__last_name', 'nfc_uid', 'station']
    ordering_fields = ['access_time', 'user__student_id', 'user__last_name', 'station', 'cabinet_name']
    ordering = ['-access_time']
    pagination_class = AccessLogPagination

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.user.is_authenticated and request.user.role != User.RoleChoices.ADMIN:
            omit_response_fields(response.data, {'nfc_uid'})
        return response

    def paginate_queryset(self, queryset):
        if self.request.user.role == User.RoleChoices.INSTRUCTOR:
            self._paginator = AccessLogPagination()
        return super().paginate_queryset(queryset)

    def get_permissions(self):
        if self.action == 'filter_options':
            return [IsInstructorRole()]
        if self.action in ['list', 'retrieve', 'stats']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return AccessLog.objects.select_related('user', 'user__section', 'cabinet_session', 'photo').all()
        if user.role == 'student':
            return AccessLog.objects.filter(user=user).select_related('user', 'cabinet_session', 'user__section', 'photo')
        if user.role == 'instructor':
            student_filters = Q(user__role=User.RoleChoices.STUDENT)
            instructor_filters = Q(user__section__instructor=user) | Q(user__section__assigned_instructors=user)
            return AccessLog.objects.filter(student_filters & instructor_filters).select_related(
                'user', 'cabinet_session', 'user__section', 'photo',
            ).distinct()
        return AccessLog.objects.none()

    @action(detail=False, methods=['post'], url_path='export-excel')
    def export_excel(self, request):
        selected_ids = requested_export_ids(request)
        if selected_ids is None:
            return Response({'ids': ['Select one or more access logs to export.']}, status=status.HTTP_400_BAD_REQUEST)

        logs = self.filter_queryset(self.get_queryset()).filter(pk__in=selected_ids).select_related(
            'user', 'user__section', 'cabinet_session', 'photo',
        ).prefetch_related('user__assigned_sections').order_by('-access_time', '-pk')
        record_count = logs.count()
        if not record_count:
            return Response({'ids': ['No selected access logs are available to export.']}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AccessLogSerializer()

        def export_rows():
            for log in logs.iterator(chunk_size=500):
                user = log.user
                if user and user.role == User.RoleChoices.INSTRUCTOR:
                    section_names = '; '.join(section.section_name for section in user.assigned_sections.all())
                else:
                    section_names = user.section.section_name if user and user.section else ''
                full_name = f'{user.first_name} {user.last_name}'.strip() if user else ''
                if not full_name and user:
                    full_name = user.username
                try:
                    photo_status = log.photo.capture_status
                except AccessLogPhoto.DoesNotExist:
                    photo_status = None
                yield (
                    timezone.localtime(log.access_time, ZoneInfo('Asia/Manila')) if log.access_time else None,
                    full_name,
                    user.role if user else '',
                    section_names,
                    serializer.get_station(log),
                    log.cabinet_name,
                    serializer.get_access_type(log),
                    log.get_action_display(),
                    log.get_status_display(),
                    photo_status,
                    format_duration(serializer.get_duration_seconds(log)),
                )

        scope = 'Current filtered results' if request.data.get('scope') == 'filtered' else 'Selected records'
        return branded_excel_response(
            report_name='Access History Report',
            filename='access-history-report.xlsx',
            headers=('Date and Time', 'User', 'Role', 'Section', 'Station', 'Cabinet', 'Access Type', 'Action', 'Result', 'Photo Status', 'Duration'),
            rows=export_rows(),
            record_count=record_count,
            scope=scope,
            result_header='Result',
        )

    @action(detail=False, methods=['get'], url_path='filter-options')
    def filter_options(self, request):
        queryset = self.get_queryset()
        section_id = request.query_params.get('user__section')
        if section_id:
            queryset = queryset.filter(user__section_id=section_id)
        cabinet_names = queryset.exclude(cabinet_name='').order_by('cabinet_name').values_list('cabinet_name', flat=True).distinct()
        return Response({'cabinets': list(cabinet_names)})

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return today's access statistics.

        - For admins: overall counts across all users
        - For instructors: counts limited to their students (uses get_queryset())
        """
        user = request.user
        today = timezone.localdate()

        if user.role == 'admin':
            base_qs = AccessLog.objects.filter(access_time__date=today)
        elif user.role == 'instructor':
            base_qs = self.filter_queryset(self.get_queryset()).filter(access_time__date=today)
        elif user.role == 'student':
            base_qs = self.filter_queryset(self.get_queryset()).filter(access_time__date=today)
        else:
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        total_accesses = base_qs.count()
        successful = base_qs.filter(status=AccessLog.AccessStatusChoices.SUCCESS).count()
        failed = (
            base_qs.exclude(status=AccessLog.AccessStatusChoices.SUCCESS).count()
            if user.role == User.RoleChoices.INSTRUCTOR
            else base_qs.filter(status=AccessLog.AccessStatusChoices.FAILED).count()
        )
        active_students = base_qs.filter(user__isnull=False).values('user').distinct().count()

        return Response({
            'total_accesses_today': total_accesses,
            'successful_accesses_today': successful,
            'failed_accesses_today': failed,
            'active_students_today': active_students,
        })


class NotificationViewSet(viewsets.ModelViewSet):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [OrderingFilter]
    ordering_fields = ['created_at', 'is_read']
    ordering = ['-created_at']
    pagination_class = PageNumberPagination

    def get_queryset(self):
        user = self.request.user
        if user.role == 'instructor':
            return Notification.objects.filter(instructor=user)
        if user.role == 'student':
            return Notification.objects.filter(student=user)
        return Notification.objects.none()

    def list(self, request, *args, **kwargs):
        if request.user.role == 'instructor':
            create_deadline_notifications_for_instructor(request.user)
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save()
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        notifications = self.get_queryset().filter(is_read=False)
        count = notifications.update(is_read=True)
        return Response({'marked': count})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = self.get_queryset().filter(is_read=False).count()
        return Response({'unread_count': count})


class CabinetEventViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    ViewSet for managing Cabinet Events.
    Returns latest events first with filtering by event type.
    """
    queryset = CabinetEvent.objects.select_related('user', 'user__section').all()
    serializer_class = CabinetEventSerializer
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['event_type', 'user', 'timestamp']
    search_fields = ['user__first_name', 'user__last_name', 'event_type']
    ordering_fields = ['timestamp']
    ordering = ['-timestamp']


class CustomTokenObtainPairView(TokenObtainPairView):
    # Allow any user to obtain tokens
    permission_classes = [AllowAny]
    serializer_class = CustomTokenObtainPairSerializer

    def _build_role_error_message(self, actual_role):
        role_display = {
            'admin': 'Admin',
            'instructor': 'Instructor',
            'student': 'Student',
        }
        if actual_role in role_display:
            return f'Access denied. Please use the {role_display[actual_role]} Login.'
        return 'Access denied. This login is only for authorized users.'

    def post(self, request, *args, **kwargs):
        expected_role = request.data.get('expected_role', '').strip().lower()
        serializer = self.get_serializer(data=request.data)

        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        actual_role = serializer.user.role if hasattr(serializer, 'user') else None
        if expected_role and actual_role and actual_role != expected_role:
            return Response(
                {'detail': self._build_role_error_message(actual_role)},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(serializer.validated_data, status=status.HTTP_200_OK)
class VerifyNFCView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]         # API key instead

    def _active_session_for_user(self, user, device_context):
        sessions_query = CabinetSession.objects.filter(
            status=CabinetSession.StatusChoices.OPEN,
            station__in=settings.TAPTRACK_CABINET_STATIONS,
        )
        if device_context.get('mock') and device_context.get('station'):
            sessions_query = sessions_query.filter(station=device_context['station'])
        else:
            workflow_sessions = sessions_query.filter(
                workflow_state__in=(
                    CabinetSession.WorkflowStateChoices.OPENING,
                    CabinetSession.WorkflowStateChoices.CLOSING,
                ),
            )
            workflow_matches = list(workflow_sessions.order_by('-opened_at')[:2])
            if workflow_matches:
                return workflow_matches[0] if len(workflow_matches) == 1 else None
            if user:
                sessions_query = sessions_query.filter(opened_by=user)
        sessions = list(sessions_query.order_by('-opened_at')[:2])
        return sessions[0] if len(sessions) == 1 else None

    def _create_scan_log(self, nfc_uid, user, access_status, reason, device_context):
        cabinet_session = self._active_session_for_user(user, device_context)
        status_value = access_status
        reason_value = reason
        action = AccessLog.AccessActionChoices.SCAN
        if cabinet_session and cabinet_session.workflow_state == CabinetSession.WorkflowStateChoices.OPENING:
            if status_value == AccessLog.AccessStatusChoices.SUCCESS:
                if user.role != User.RoleChoices.STUDENT:
                    status_value = AccessLog.AccessStatusChoices.REJECTED
                    reason_value = 'Only students can join a cabinet session'
                elif cabinet_session.opened_by.filter(pk=user.pk).exists():
                    status_value = AccessLog.AccessStatusChoices.DUPLICATE
                    reason_value = 'Duplicate participant scan'
                else:
                    action = (
                        AccessLog.AccessActionChoices.OPEN
                        if not cabinet_session.access_logs.filter(action=AccessLog.AccessActionChoices.OPEN).exists()
                        else AccessLog.AccessActionChoices.SCAN
                    )
                    cabinet_session.opened_by.add(user)
        elif cabinet_session and cabinet_session.workflow_state == CabinetSession.WorkflowStateChoices.CLOSING:
            action = AccessLog.AccessActionChoices.CLOSE
            if status_value == AccessLog.AccessStatusChoices.SUCCESS:
                if not cabinet_session.opened_by.filter(pk=user.pk).exists():
                    status_value = AccessLog.AccessStatusChoices.REJECTED
                    reason_value = 'Participant is not part of this cabinet session'
                elif cabinet_session.closed_by.filter(pk=user.pk).exists():
                    status_value = AccessLog.AccessStatusChoices.DUPLICATE
                    reason_value = 'Duplicate participant scan'
                else:
                    cabinet_session.closed_by.add(user)
                    reason_value = 'Cabinet close attendance recorded'
        elif (
            status_value == AccessLog.AccessStatusChoices.SUCCESS
            and cabinet_session
            and AccessLog.objects.filter(
                user=user,
                cabinet_session=cabinet_session,
                action=AccessLog.AccessActionChoices.SCAN,
                status=AccessLog.AccessStatusChoices.SUCCESS,
            ).exists()
        ):
            status_value = AccessLog.AccessStatusChoices.DUPLICATE
            reason_value = 'Duplicate participant scan'

        station_name = (cabinet_session.station if cabinet_session else '') or device_context.get('station') or ''
        access_log = AccessLog.objects.create(
            user=user,
            cabinet_session=cabinet_session,
            status=status_value,
            action=action,
            nfc_uid=nfc_uid,
            station=station_name,
            cabinet_name=device_context.get('cabinet_name') or settings.TAPTRACK_CABINET_NAME,
            reason=reason_value,
        )
        if user:
            if status_value == AccessLog.AccessStatusChoices.SUCCESS:
                if action == AccessLog.AccessActionChoices.OPEN:
                    event_type = 'cabinet_opened'
                elif action == AccessLog.AccessActionChoices.CLOSE:
                    event_type = 'cabinet_closed'
                else:
                    event_type = 'access_granted'
            elif 'timeout' in reason_value.lower():
                event_type = 'session_timeout'
            elif 'unlock' in reason_value.lower():
                event_type = 'unlock_failed'
            else:
                event_type = 'access_denied'

            CabinetEvent.objects.create(
                user=user,
                event_type=event_type,
                details={
                    'access_log_id': access_log.pk,
                    'cabinet_session_id': cabinet_session.pk if cabinet_session else None,
                    'event_type': event_type,
                    'action': access_log.action,
                    'station': access_log.station,
                    'cabinet_id': access_log.cabinet_name,
                    'nfc_uid': access_log.nfc_uid,
                    'access_method': 'NFC',
                    'result': access_log.status,
                    'failure_reason': access_log.reason if access_log.status != AccessLog.AccessStatusChoices.SUCCESS else '',
                },
            )
        return access_log

    def _event_payload(self, access_log):
        user = access_log.user
        return {
            'event_id': access_log.id,
            'success': access_log.status == AccessLog.AccessStatusChoices.SUCCESS,
            'status': access_log.status,
            'action': access_log.action,
            'nfc_uid': access_log.nfc_uid,
            'user': {
                'id': user.id,
                'student_id': user.student_id,
                'name': user.get_full_name().strip(),
                'role': user.role,
            } if user else None,
            'cabinet': {'name': access_log.cabinet_name} if access_log.cabinet_name else None,
            'station': {'name': access_log.station} if access_log.station else None,
            'cabinet_session_id': access_log.cabinet_session_id,
            'reason': access_log.reason,
            'name': user.get_full_name().strip() if user else None,
            'role': user.role if user else None,
            'student_id': user.student_id if user else None,
        }

    def _unregistered_response(self, nfc_uid, device_context, registration_target_user=None):
        access_log = self._create_scan_log(
            nfc_uid,
            user=None,
            access_status=AccessLog.AccessStatusChoices.UNREGISTERED,
            reason='NFC UID is not registered',
            device_context=device_context,
        )
        token = secrets.token_urlsafe(32)
        now = timezone.now()
        expires_at = now + timedelta(seconds=600)
        with transaction.atomic():
            device_id = str(device_context.get('device_id') or '').strip()
            if not device_id:
                return Response(
                    {'success': False, 'error': 'This NFC reader is not mapped to a cabinet device.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            NFCEnrollmentSession.objects.select_for_update().filter(
                device_id=device_id,
                status=NFCEnrollmentSession.StatusChoices.PENDING,
            ).update(status=NFCEnrollmentSession.StatusChoices.CANCELLED, token_hash='')
            active_session = self._active_session_for_user(None, device_context)
            enrollment = NFCEnrollmentSession(
                nfc_uid=nfc_uid,
                device_id=device_id,
                token_digest='',
                token_hash='',
                expires_at=expires_at,
                completion_expires_at=expires_at,
                station=(active_session.station if active_session else '') or device_context.get('station') or '',
                cabinet_name=device_context.get('cabinet_name') or settings.TAPTRACK_CABINET_NAME,
                registration_target_user=registration_target_user,
            )
            enrollment.set_token(token)
            enrollment.save()
        registration_url = f'{settings.NFC_REGISTRATION_URL_BASE}?token={quote(token, safe="")}'
        return Response(
            {
                **self._event_payload(access_log),
                'success': False,
                'registered': False,
                'registration_required': True,
                'session_id': enrollment.pk,
                'registration_url': registration_url,
                'expires_at': enrollment.expires_at.isoformat(),
                'server_time': now.isoformat(),
                'error': 'NFC card not registered.',
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    def post(self, request, *args, **kwargs):
        received_nfc_uid = str(request.data.get('nfc_uid') or '')
        nfc_uid = AccessLog.normalize_nfc_uid(received_nfc_uid)
        device_context = getattr(request, 'nfc_device_context', {})
        logger.info('NFC verification request received: raw_uid=%r normalized_uid=%r', received_nfc_uid, nfc_uid)
        if not nfc_uid:
            return Response(
                {'success': False, 'error': 'NFC UID is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if device_context.get('mock'):
            mock_station = str(request.data.get('station') or '').strip()
            if mock_station not in settings.TAPTRACK_CABINET_STATIONS:
                return Response(
                    {'success': False, 'error': 'Select a configured mock station.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            device_context = {
                **device_context,
                'station': mock_station,
                'cabinet_name': settings.TAPTRACK_CABINET_NAME,
            }
        elif not device_context.get('cabinet_name'):
            return Response(
                {'success': False, 'error': 'This NFC reader is not mapped to a cabinet.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = User.objects.filter(nfc_uid=nfc_uid).first()
        logger.info(
            'NFC verification lookup: model=%s field=User.nfc_uid match=%s username=%r student_id=%r active=%s',
            User._meta.label,
            bool(user),
            user.username if user else None,
            user.student_id if user else None,
            user.is_active if user else None,
        )

        if user and user.is_active and not user.has_usable_password():
            return self._unregistered_response(nfc_uid, device_context, registration_target_user=user)

        if user and user.is_active:
            access_log = self._create_scan_log(
                nfc_uid,
                user,
                AccessLog.AccessStatusChoices.SUCCESS,
                'NFC verified successfully',
                device_context,
            )
            if access_log.status in (AccessLog.AccessStatusChoices.DUPLICATE, AccessLog.AccessStatusChoices.REJECTED):
                return Response(
                    {**self._event_payload(access_log), 'success': False, 'error': access_log.reason},
                    status=(
                        status.HTTP_409_CONFLICT
                        if access_log.status == AccessLog.AccessStatusChoices.DUPLICATE
                        else status.HTTP_403_FORBIDDEN
                    ),
                )
            create_access_log_notifications(access_log)
            return Response(
                self._event_payload(access_log),
                status=status.HTTP_200_OK,
            )

        if user and not user.is_active:
            access_log = self._create_scan_log(
                nfc_uid,
                user,
                AccessLog.AccessStatusChoices.FAILED,
                'User account is inactive',
                device_context,
            )
            return Response(
                {**self._event_payload(access_log), 'success': False, 'error': 'User account is inactive.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        return self._unregistered_response(nfc_uid, device_context)


class CabinetLocationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        cabinet_name = str(request.query_params.get('cabinet_name') or '').strip()
        location = None
        if cabinet_name:
            location = CabinetLocation.objects.filter(cabinet_name=cabinet_name, is_active=True).first()
        if location is None:
            location = CabinetLocation.objects.filter(is_active=True).order_by('cabinet_name').first()
        if location is None:
            location = {
                'cabinet_name': 'TapTrack Cabinet',
                'institution_name': 'University of Science and Technology of Southern Philippines',
                'college_name': 'College of Information Technology and Computing',
                'building_name': 'CITC Building',
                'location_description': 'Hallway near the CITC Office',
                'purpose': 'Laboratory Equipment Storage and Monitoring',
            }
        else:
            location = {
                'cabinet_name': location.cabinet_name,
                'institution_name': location.institution_name,
                'college_name': location.college_name,
                'building_name': location.building_name,
                'location_description': location.location_description,
                'purpose': location.purpose,
            }
        return Response(location, status=status.HTTP_200_OK)

    def patch(self, request, *args, **kwargs):
        if not request.user.is_authenticated or request.user.role != User.RoleChoices.ADMIN:
            return Response({'detail': 'Only authorized administrators can edit cabinet location.'}, status=status.HTTP_403_FORBIDDEN)
        cabinet_name = str(request.data.get('cabinet_name') or '').strip()
        if not cabinet_name:
            return Response({'cabinet_name': 'Cabinet name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        location, _ = CabinetLocation.objects.get_or_create(cabinet_name=cabinet_name)
        allowed = {'institution_name', 'college_name', 'building_name', 'location_description', 'purpose', 'is_active'}
        for field in allowed:
            if field in request.data:
                setattr(location, field, request.data[field])
        location.save()
        return Response({
            'cabinet_name': location.cabinet_name,
            'institution_name': location.institution_name,
            'college_name': location.college_name,
            'building_name': location.building_name,
            'location_description': location.location_description,
            'purpose': location.purpose,
        }, status=status.HTTP_200_OK)


class NFCEnrollmentValidationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [NFCEnrollmentRateThrottle]

    def get(self, request, *args, **kwargs):
        token = (request.query_params.get('token') or '').strip()
        if not token:
            return Response(
                {'valid': False, 'error': 'This NFC registration session is invalid or expired.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        with transaction.atomic():
            enrollment = NFCEnrollmentSession.objects.select_for_update().filter(
                token_digest=token_digest,
            ).first()
            if not enrollment:
                return Response({
                    'valid': False,
                    'status': 'cancelled',
                    'code': 'SESSION_ALREADY_USED',
                    'error': 'Registration session expired or already used. Tap your ID card again.'
                }, status=status.HTTP_410_GONE)
            if enrollment.status == NFCEnrollmentSession.StatusChoices.COMPLETED:
                return Response({
                    'valid': False,
                    'status': 'completed',
                    'session_id': enrollment.pk,
                    'expires_at': enrollment.expires_at.isoformat(),
                    'server_time': timezone.now().isoformat(),
                }, status=status.HTTP_200_OK)
            if enrollment.status == NFCEnrollmentSession.StatusChoices.CANCELLED:
                return Response({
                    'valid': False,
                    'status': 'cancelled',
                    'code': 'SESSION_CANCELLED',
                }, status=status.HTTP_410_GONE)
            if enrollment.status == NFCEnrollmentSession.StatusChoices.EXPIRED:
                return Response({
                    'valid': False,
                    'status': 'expired',
                    'code': 'SESSION_EXPIRED',
                }, status=status.HTTP_410_GONE)

            now = timezone.now()
            expired = enrollment.expires_at <= now
            if expired:
                enrollment.status = NFCEnrollmentSession.StatusChoices.EXPIRED
                enrollment.token_hash = ''
                enrollment.save(update_fields=['status', 'token_hash'])
                return Response({
                    'valid': False,
                    'status': 'expired',
                    'code': 'SESSION_EXPIRED',
                    'error': 'Registration session expired. Please return to the cabinet and tap your NFC card again.'
                }, status=status.HTTP_410_GONE)

            if enrollment.completion_expires_at != enrollment.expires_at:
                enrollment.completion_expires_at = enrollment.expires_at
                enrollment.save(update_fields=['completion_expires_at'])

            return Response({
                'valid': True,
                'status': 'pending',
                'session_id': enrollment.pk,
                'qr_expires_at': enrollment.expires_at.isoformat(),
                'expires_at': enrollment.expires_at.isoformat(),
                'completion_expires_at': enrollment.expires_at.isoformat(),
                'server_time': now.isoformat(),
            }, status=status.HTTP_200_OK)


class NFCEnrollmentCancellationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [NFCEnrollmentRateThrottle]

    def post(self, request, *args, **kwargs):
        token = str(request.data.get('token') or '').strip()
        if not token or len(token) > 256:
            return Response({'error': 'A valid enrollment token is required.'}, status=status.HTTP_400_BAD_REQUEST)
        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        with transaction.atomic():
            enrollment = NFCEnrollmentSession.objects.select_for_update().filter(
                token_digest=token_digest,
                status=NFCEnrollmentSession.StatusChoices.PENDING,
            ).first()
            if not enrollment:
                return Response({'cancelled': False}, status=status.HTTP_200_OK)
            enrollment.status = NFCEnrollmentSession.StatusChoices.CANCELLED
            enrollment.token_hash = ''
            enrollment.save(update_fields=['status', 'token_hash'])
        logger.info('nfc_enrollment_cancelled enrollment_id=%s', enrollment.pk)
        return Response({'cancelled': True}, status=status.HTTP_200_OK)


class NFCEnrollmentRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [NFCEnrollmentRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = NFCEnrollmentRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            return self._register(data)
        except IntegrityError:
            logger.warning('nfc_registration_integrity_conflict')
            return Response({
                'code': 'NFC_OWNERSHIP_CONFLICT',
                'error': 'The username or ID card could not be registered because it was claimed by another account.'
            }, status=status.HTTP_400_BAD_REQUEST)

    def _register(self, data):
        token = data['token'].strip()
        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        identifier_value = data['id_number']
        with transaction.atomic():
            enrollment = NFCEnrollmentSession.objects.select_for_update().filter(
                token_digest=token_digest,
            ).first()
            if not enrollment or enrollment.status != NFCEnrollmentSession.StatusChoices.PENDING:
                return Response({
                    'code': 'SESSION_ALREADY_USED',
                    'error': 'Registration session expired or already used. Tap your ID card again.'
                }, status=status.HTTP_410_GONE)
            now = timezone.now()
            if enrollment.expires_at <= now:
                enrollment.status = NFCEnrollmentSession.StatusChoices.EXPIRED
                enrollment.token_hash = ''
                enrollment.save(update_fields=['status', 'token_hash'])
                return Response({
                    'code': 'SESSION_EXPIRED',
                    'error': 'Registration session expired. Please return to the cabinet and tap your ID card again.'
                }, status=status.HTTP_410_GONE)

            user = enrollment.registration_target_user
            if not user:
                candidate_filters = (
                    Q(student_id=identifier_value)
                    | Q(instructor_id=identifier_value)
                    | Q(administrator_id=identifier_value)
                )
                candidate_rows = list(
                    User.objects.select_for_update()
                    .filter(candidate_filters, email__iexact=str(data['email']).strip(), is_active=True)
                    [:10]
                )
                candidates = [candidate for candidate in candidate_rows if not candidate.has_usable_password()]
                if len(candidates) != 1:
                    logger.info('nfc_registration_account_lookup_failed enrollment_id=%s candidates=%s', enrollment.pk, len(candidates))
                    return Response({
                        'code': 'ACCOUNT_NOT_FOUND',
                        'error': 'No eligible pending account matches the entered ID number and email.'
                    }, status=status.HTTP_404_NOT_FOUND)
                user = candidates[0]
            user = User.objects.select_for_update().get(pk=user.pk)
            identifier_field = (
                'student_id' if user.role == User.RoleChoices.STUDENT else
                'instructor_id' if user.role == User.RoleChoices.INSTRUCTOR else
                'administrator_id'
            )
            if not user.is_active:
                logger.warning('nfc_registration_account_not_eligible enrollment_id=%s', enrollment.pk)
                return Response({
                    'code': 'ACCOUNT_NOT_ELIGIBLE',
                    'error': 'This account is not eligible for registration.'
                }, status=status.HTTP_400_BAD_REQUEST)
            if user.has_usable_password():
                return Response({
                    'code': 'SESSION_ALREADY_USED',
                    'error': 'This account has already been registered.'
                }, status=status.HTTP_409_CONFLICT)
            normalized_identifier = str(getattr(user, identifier_field, '') or '').strip()
            normalized_input_identifier = str(identifier_value or '').strip()
            if (
                normalized_identifier != normalized_input_identifier
                or str(user.email or '').strip().lower() != str(data['email']).strip().lower()
            ):
                logger.info('nfc_registration_identity_mismatch enrollment_id=%s', enrollment.pk)
                return Response({
                    'code': 'IDENTITY_MISMATCH',
                    'error': 'The ID number or email does not match the account authorized for this card tap.'
                }, status=status.HTTP_400_BAD_REQUEST)
            normalized_assigned_uid = ''.join(str(user.nfc_uid or '').split()).upper()
            normalized_enrollment_uid = ''.join(str(enrollment.nfc_uid or '').split()).upper()
            if User.objects.filter(nfc_uid__iexact=normalized_enrollment_uid).exclude(pk=user.pk).exists():
                logger.warning('nfc_registration_uid_already_assigned enrollment_id=%s', enrollment.pk)
                return Response({
                    'code': 'NFC_OWNERSHIP_CONFLICT',
                    'error': 'This ID card is assigned to a different account.'
                }, status=status.HTTP_409_CONFLICT)
            if normalized_assigned_uid and normalized_assigned_uid != normalized_enrollment_uid:
                logger.warning('nfc_registration_ownership_conflict enrollment_id=%s', enrollment.pk)
                return Response({
                    'code': 'NFC_OWNERSHIP_CONFLICT',
                    'error': 'This ID card is assigned to a different account.'
                }, status=status.HTTP_409_CONFLICT)
            if user.role == User.RoleChoices.ADMIN and not (user.is_staff or user.is_superuser):
                return Response({
                    'code': 'REGISTRATION_AUTHORIZATION_REQUIRED',
                    'error': 'This administrator account is not authorized for registration.'
                }, status=status.HTTP_403_FORBIDDEN)
            try:
                validate_password(data['password'], user=user)
            except DjangoValidationError as exc:
                return Response({
                    'code': 'INVALID_PASSWORD',
                    'password': exc.messages,
                }, status=status.HTTP_400_BAD_REQUEST)
            username = data['username'].strip()
            if User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists():
                return Response({
                    'code': 'USERNAME_ALREADY_EXISTS',
                    'error': 'That username is already in use.',
                    'username': ['That username is unavailable. Please choose another.']
                }, status=status.HTTP_409_CONFLICT)

            user.username = username
            user.nfc_uid = enrollment.nfc_uid
            user.set_password(data['password'])
            user.save(update_fields=[
                'username', 'nfc_uid', 'password', 'updated_at',
            ])
            enrollment.status = NFCEnrollmentSession.StatusChoices.COMPLETED
            enrollment.completed_at = now
            enrollment.completed_by = user
            enrollment.token_hash = ''
            enrollment.save(update_fields=['status', 'completed_at', 'completed_by', 'token_hash'])
            NFCEnrollmentSession.objects.filter(
                device_id=enrollment.device_id,
                nfc_uid=enrollment.nfc_uid,
                status=NFCEnrollmentSession.StatusChoices.PENDING,
            ).exclude(pk=enrollment.pk).update(
                status=NFCEnrollmentSession.StatusChoices.CANCELLED,
                token_hash='',
            )
            AccessLog.objects.create(
                user=user,
                status=AccessLog.AccessStatusChoices.SUCCESS,
                action=AccessLog.AccessActionChoices.REGISTRATION,
                nfc_uid=enrollment.nfc_uid,
                station=enrollment.station,
                cabinet_name=enrollment.cabinet_name,
                reason='NFC card registered successfully',
            )

        return Response(
            {
                'success': True,
                'message': 'Registration successful.',
                'role': user.role,
                'registration_status': 'registered',
                'administrator_id': user.administrator_id if user.role == User.RoleChoices.ADMIN else None,
                'student_id': user.student_id,
                'instructor_id': user.instructor_id,
                'name': user.get_full_name().strip(),
                'nfc_registered': True,
            },
            status=status.HTTP_201_CREATED,
        )


class CabinetRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def post(self, request, *args, **kwargs):
        serializer = CabinetRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = data.get('role', User.RoleChoices.STUDENT)
        identifier_field = 'student_id' if role == User.RoleChoices.STUDENT else 'instructor_id'
        identifier_value = data.get(identifier_field, '').strip()
        nfc_uid = data['nfc_uid'].strip().upper()
        email = data['email'].strip().lower()

        if User.objects.filter(role=role, **{identifier_field: identifier_value}).exists():
            account_label = 'Student ID' if role == User.RoleChoices.STUDENT else 'Instructor ID'
            return Response({'error': f'{account_label} is already registered.'}, status=status.HTTP_409_CONFLICT)
        if User.objects.filter(nfc_uid=nfc_uid).exists():
            return Response({'error': 'NFC card is already registered.'}, status=status.HTTP_409_CONFLICT)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'Email is already registered.'}, status=status.HTTP_409_CONFLICT)

        section_value = data.get('section', '').strip()
        section = None
        if section_value:
            section = Section.objects.filter(
                models.Q(subject_code__iexact=section_value)
                | models.Q(section_name__iexact=section_value)
            ).first()
            if not section:
                return Response({'error': 'Section was not found.'}, status=status.HTTP_400_BAD_REQUEST)

        name_parts = data['full_name'].strip().split(None, 1)
        if role == User.RoleChoices.STUDENT:
            username = identifier_value or data['full_name'].strip().replace(' ', '_')
            user = User(
                username=username,
                student_id=identifier_value,
                email=email,
                first_name=name_parts[0],
                last_name=name_parts[1] if len(name_parts) > 1 else '',
                role=User.RoleChoices.STUDENT,
                section=section,
                nfc_uid=nfc_uid,
            )
        else:
            username = identifier_value or data['full_name'].strip().replace(' ', '_')
            user = User(
                username=username,
                instructor_id=identifier_value,
                email=email,
                first_name=name_parts[0],
                last_name=name_parts[1] if len(name_parts) > 1 else '',
                role=User.RoleChoices.INSTRUCTOR,
                section=section,
                nfc_uid=nfc_uid,
            )
        user.set_unusable_password()
        try:
            user.full_clean()
            user.save()
        except Exception as error:
            if hasattr(error, 'message_dict'):
                return Response(error.message_dict, status=status.HTTP_400_BAD_REQUEST)
            return Response({'error': 'Registration could not be completed.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'id': user.id,
            'role': user.role,
            'student_id': user.student_id,
            'instructor_id': user.instructor_id,
            'name': user.get_full_name().strip(),
            'email': user.email,
            'section': section.subject_code or section.section_name if section else '',
            'nfc_uid': user.nfc_uid,
        }, status=status.HTTP_201_CREATED)


class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student_id = serializer.validated_data['student_id'].strip()
        email = serializer.validated_data['email'].strip()
        if not student_id:
            return Response(
                {'student_id': ['Student ID is required.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(
            student_id=student_id,
            email__iexact=email,
            is_active=True,
            role=User.RoleChoices.STUDENT,
        ).first()
        if user and not str(user.nfc_uid or '').strip():
            user = None

        with transaction.atomic():
            if user:
                previous_request = PasswordResetRequest.objects.select_for_update().filter(
                    user=user,
                    status__in=[
                        PasswordResetRequest.StatusChoices.PENDING,
                        PasswordResetRequest.StatusChoices.VERIFIED,
                    ],
                ).order_by('-requested_at').first()

                if previous_request and not previous_request.is_expired:
                    previous_request.status = PasswordResetRequest.StatusChoices.CANCELLED
                    previous_request.reason = 'Replaced by a newer reset request.'
                    previous_request.save(update_fields=['status', 'reason'])
                    record_password_recovery_event(
                        previous_request,
                        PasswordRecoveryAuditEvent.EventType.REQUEST_CANCELLED,
                        PasswordRecoveryAuditEvent.Outcome.INFO,
                        reason_code='replaced_by_newer_request',
                        actor_type=PasswordRecoveryAuditEvent.ActorType.PORTAL,
                    )

            reset_request = PasswordResetRequest.objects.create(
                user=user,
                student_id_snapshot=(user.student_id or '') if user else '',
                email_snapshot=(user.email or '') if user else '',
                status=PasswordResetRequest.StatusChoices.PENDING,
                expires_at=timezone.now() + timedelta(minutes=15),
            )
            record_password_recovery_event(
                reset_request,
                PasswordRecoveryAuditEvent.EventType.REQUEST_CREATED,
                PasswordRecoveryAuditEvent.Outcome.SUCCESS,
                actor_type=PasswordRecoveryAuditEvent.ActorType.PORTAL,
            )

        return Response(
            {
                'message': 'If the supplied details match an eligible account, continue verification at the cabinet.',
                'request_id': reset_request.request_id,
                'expires_at': reset_request.expires_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetCancellationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetCancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_id = serializer.validated_data['request_id']
        with transaction.atomic():
            reset_request = PasswordResetRequest.objects.select_for_update().filter(request_id=request_id).first()
            if not reset_request:
                return Response({'cancelled': True})
            if reset_request.status in (
                PasswordResetRequest.StatusChoices.VERIFIED,
                PasswordResetRequest.StatusChoices.USED,
                PasswordResetRequest.StatusChoices.CANCELLED,
            ):
                return Response({'cancelled': False, 'status': reset_request.status})
            reset_request.status = PasswordResetRequest.StatusChoices.CANCELLED
            reset_request.reason = 'Cancelled by the cabinet.'
            reset_request.save(update_fields=['status', 'reason'])
            record_password_recovery_event(
                reset_request,
                PasswordRecoveryAuditEvent.EventType.REQUEST_CANCELLED,
                PasswordRecoveryAuditEvent.Outcome.INFO,
                reason_code='cancelled_by_cabinet',
                actor_type=PasswordRecoveryAuditEvent.ActorType.CABINET,
            )
        return Response({'cancelled': True, 'status': reset_request.status})


class PasswordResetCabinetQueueView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def get(self, request, *args, **kwargs):
        now = timezone.now()
        with transaction.atomic():
            queued = PasswordResetRequest.objects.select_for_update().filter(
                status=PasswordResetRequest.StatusChoices.PENDING,
                user__is_active=True,
                expires_at__gt=now,
            ).select_related('user').order_by('requested_at')
            items = []
            for reset_request in queued:
                name = reset_request.user.get_full_name().strip() or reset_request.user.username
                student_id = reset_request.student_id_snapshot or reset_request.user.student_id or ''
                masked_reference = f'•••{student_id[-4:]}' if student_id else '••••'
                items.append({
                    'request_id': reset_request.request_id,
                    'display_name': name,
                    'account_reference': masked_reference,
                    'status': reset_request.status,
                    'requested_at': reset_request.requested_at.isoformat(),
                    'expires_at': reset_request.expires_at.isoformat(),
                })
        return Response({'count': len(items), 'results': items})


class PasswordResetStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetStatusRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_id = serializer.validated_data['request_id']

        with transaction.atomic():
            reset_request = PasswordResetRequest.objects.select_for_update().filter(
                request_id=request_id,
            ).first()

            if not reset_request:
                return Response({'status': PasswordResetRequest.StatusChoices.PENDING})

            if reset_request.is_expired:
                if reset_request.status not in (
                    PasswordResetRequest.StatusChoices.USED,
                    PasswordResetRequest.StatusChoices.CANCELLED,
                ):
                    reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
                    reset_request.save(update_fields=['status'])
                    record_password_recovery_event(
                        reset_request,
                        PasswordRecoveryAuditEvent.EventType.REQUEST_EXPIRED,
                        PasswordRecoveryAuditEvent.Outcome.INFO,
                        reason_code='request_expired',
                        actor_type=PasswordRecoveryAuditEvent.ActorType.DJANGO,
                    )
                return Response({'status': reset_request.status})

            if reset_request.status != PasswordResetRequest.StatusChoices.VERIFIED:
                return Response({'status': reset_request.status})

            if not reset_request.nfc_uid_verified or not reset_request.verified_at:
                return Response({'status': PasswordResetRequest.StatusChoices.PENDING})

            authorization_signer = signing.Signer(salt='api.password-reset-authorization')
            authorization_expires_at = reset_request.reset_authorization_expires_at
            token_is_current = (
                reset_request.reset_authorization_nonce
                and authorization_expires_at
                and timezone.now() <= authorization_expires_at
            )
            authorization = None
            if token_is_current:
                authorization = authorization_signer.sign(
                    f'{reset_request.request_id}:{reset_request.reset_authorization_nonce}'
                )
                token_is_current = reset_request.verify_reset_authorization(authorization)

            if not token_is_current:
                nonce = secrets.token_urlsafe(32)
                authorization = authorization_signer.sign(f'{reset_request.request_id}:{nonce}')
                authorization_expires_at = min(
                    reset_request.expires_at,
                    timezone.now() + timedelta(minutes=5),
                )
                reset_request.set_reset_authorization(authorization)
                reset_request.reset_authorization_nonce = nonce
                reset_request.reset_authorization_expires_at = authorization_expires_at
                reset_request.reset_authorization_used_at = None
                reset_request.save(update_fields=[
                    'reset_authorization_hash',
                    'reset_authorization_nonce',
                    'reset_authorization_expires_at',
                    'reset_authorization_used_at',
                ])
                record_password_recovery_event(
                    reset_request,
                    PasswordRecoveryAuditEvent.EventType.AUTHORIZATION_ISSUE,
                    PasswordRecoveryAuditEvent.Outcome.SUCCESS,
                    reason_code='authorization_issued',
                    actor_type=PasswordRecoveryAuditEvent.ActorType.DJANGO,
                )

            return Response({
                'status': PasswordResetRequest.StatusChoices.VERIFIED,
                'reset_authorization': authorization,
                'expires_at': authorization_expires_at.isoformat(),
            })


class PasswordResetVerifyNFCView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetNFCVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request_id = serializer.validated_data['request_id']
        nfc_uid = serializer.validated_data['nfc_uid']

        with transaction.atomic():
            reset_request = PasswordResetRequest.objects.select_for_update().select_related('user').filter(
                request_id=request_id,
            ).first()
            if not reset_request or not reset_request.user_id:
                return Response({'error': 'Reset request is unavailable.'}, status=status.HTTP_404_NOT_FOUND)

            if reset_request.is_expired:
                reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
                reset_request.save(update_fields=['status'])
                return Response({'error': 'Reset request has expired.'}, status=status.HTTP_410_GONE)

            if reset_request.status == PasswordResetRequest.StatusChoices.USED:
                return Response({'error': 'Reset request has already been used.'}, status=status.HTTP_409_CONFLICT)

            if reset_request.status != PasswordResetRequest.StatusChoices.PENDING:
                return Response({'error': 'Reset request is no longer available.'}, status=status.HTTP_409_CONFLICT)

            if not reset_request.cabinet_handoff_claimed_at or reset_request.cabinet_handoff_used_at:
                return Response({'error': 'Reset request is not ready for cabinet verification.'}, status=status.HTTP_409_CONFLICT)

            if (
                not reset_request.cabinet_handoff_expires_at
                or timezone.now() > reset_request.cabinet_handoff_expires_at
            ):
                return Response({'error': 'Cabinet handoff has expired.'}, status=status.HTTP_410_GONE)

            user = reset_request.user
            expected_nfc_uid = AccessLog.normalize_nfc_uid(user.nfc_uid)
            scanned_nfc_uid = AccessLog.normalize_nfc_uid(nfc_uid)
            if not user.is_active or expected_nfc_uid != scanned_nfc_uid:
                record_password_recovery_event(
                    reset_request,
                    PasswordRecoveryAuditEvent.EventType.NFC_REJECTED,
                    PasswordRecoveryAuditEvent.Outcome.FAILURE,
                    reason_code='card_account_mismatch',
                    actor_type=PasswordRecoveryAuditEvent.ActorType.PI,
                )
                return Response({'error': 'NFC card does not match this recovery session.'}, status=status.HTTP_403_FORBIDDEN)

            reset_request.status = PasswordResetRequest.StatusChoices.VERIFIED
            reset_request.nfc_uid_verified = True
            reset_request.verified_at = timezone.now()
            reset_request.cabinet_handoff_used_at = timezone.now()
            reset_request.reset_token_hash = ''
            reset_request.save(update_fields=[
                'status',
                'nfc_uid_verified',
                'verified_at',
                'cabinet_handoff_used_at',
                'reset_token_hash',
            ])
            record_password_recovery_event(
                reset_request,
                PasswordRecoveryAuditEvent.EventType.NFC_VERIFIED,
                PasswordRecoveryAuditEvent.Outcome.SUCCESS,
                reason_code='registered_card_verified',
                actor_type=PasswordRecoveryAuditEvent.ActorType.PI,
            )

        return Response(
            {
                'message': 'Identity verified by cabinet NFC.',
                'request_id': reset_request.request_id,
                'status': PasswordResetRequest.StatusChoices.VERIFIED,
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetCabinetHandoffView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetCabinetHandoffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_id = serializer.validated_data['request_id']

        with transaction.atomic():
            reset_request = PasswordResetRequest.objects.select_for_update().filter(
                request_id=request_id,
            ).first()

            if not reset_request:
                return Response({'error': 'Reset request is unavailable.'}, status=status.HTTP_404_NOT_FOUND)

            if reset_request.is_expired:
                reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
                reset_request.save(update_fields=['status'])
                return Response({'error': 'Reset request has expired.'}, status=status.HTTP_410_GONE)

            if reset_request.status != PasswordResetRequest.StatusChoices.PENDING:
                return Response({'error': 'Reset request is no longer available.'}, status=status.HTTP_409_CONFLICT)

            if reset_request.cabinet_handoff_claimed_at:
                if reset_request.cabinet_handoff_used_at:
                    return Response({'error': 'Reset request is no longer available.'}, status=status.HTTP_409_CONFLICT)
                if reset_request.cabinet_handoff_expires_at and timezone.now() <= reset_request.cabinet_handoff_expires_at:
                    return Response(
                        {
                            'request_id': reset_request.request_id,
                            'expires_at': reset_request.cabinet_handoff_expires_at.isoformat(),
                        },
                        status=status.HTTP_200_OK,
                    )
                reset_request.cabinet_handoff_claimed_at = None
                reset_request.cabinet_handoff_expires_at = None

            handoff_expires_at = min(
                reset_request.expires_at,
                timezone.now() + timedelta(minutes=2),
            )
            reset_request.cabinet_handoff_claimed_at = timezone.now()
            reset_request.cabinet_handoff_expires_at = handoff_expires_at
            reset_request.cabinet_handoff_used_at = None
            reset_request.save(update_fields=[
                'cabinet_handoff_claimed_at',
                'cabinet_handoff_expires_at',
                'cabinet_handoff_used_at',
            ])
            record_password_recovery_event(
                reset_request,
                PasswordRecoveryAuditEvent.EventType.CABINET_CLAIMED,
                PasswordRecoveryAuditEvent.Outcome.SUCCESS,
                reason_code='cabinet_handoff_claimed',
                actor_type=PasswordRecoveryAuditEvent.ActorType.CABINET,
            )

        return Response(
            {
                'request_id': reset_request.request_id,
                'expires_at': reset_request.cabinet_handoff_expires_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetValidateTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetTokenValidationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request_id = serializer.validated_data['request_id']
        reset_token = serializer.validated_data['reset_token']
        reset_request = PasswordResetRequest.objects.filter(request_id=request_id).first()

        if not reset_request:
            return Response({'error': 'Reset token is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

        if reset_request.is_expired:
            reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
            reset_request.save(update_fields=['status'])
            return Response({'error': 'Reset token is invalid or expired.'}, status=status.HTTP_410_GONE)

        if reset_request.status == PasswordResetRequest.StatusChoices.USED:
            return Response({'error': 'This reset request has already been used.'}, status=status.HTTP_409_CONFLICT)

        if reset_request.status != PasswordResetRequest.StatusChoices.VERIFIED or not reset_request.verify_reset_token(reset_token):
            return Response({'error': 'Reset token is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

        authorization = secrets.token_urlsafe(32)
        authorization_expires_at = min(
            reset_request.expires_at,
            timezone.now() + timedelta(minutes=5),
        )
        reset_request.set_reset_authorization(authorization)
        reset_request.reset_authorization_expires_at = authorization_expires_at
        reset_request.reset_authorization_used_at = None
        reset_request.save(update_fields=[
            'reset_authorization_hash',
            'reset_authorization_expires_at',
            'reset_authorization_used_at',
        ])

        return Response(
            {
                'valid': True,
                'reset_authorization': authorization,
                'expires_at': authorization_expires_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetConfirmationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request_id = serializer.validated_data['request_id']
        reset_authorization = serializer.validated_data['reset_authorization']
        new_password = serializer.validated_data['new_password']

        with transaction.atomic():
            reset_request = PasswordResetRequest.objects.select_for_update().filter(
                request_id=request_id,
            ).select_related('user').first()

            if not reset_request:
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

            if (
                reset_request.status == PasswordResetRequest.StatusChoices.USED
                or reset_request.reset_authorization_used_at
            ):
                return Response({'error': 'Reset authorization has already been used.'}, status=status.HTTP_409_CONFLICT)

            if reset_request.status != PasswordResetRequest.StatusChoices.VERIFIED:
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

            if reset_request.is_expired:
                reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
                reset_request.save(update_fields=['status'])
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_410_GONE)

            if not reset_request.reset_authorization_expires_at:
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

            if timezone.now() > reset_request.reset_authorization_expires_at:
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_410_GONE)

            if not reset_request.verify_reset_authorization(reset_authorization):
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

            try:
                validate_password(new_password, user=reset_request.user)
            except Exception as error:
                messages = getattr(error, 'messages', [str(error)])
                return Response({'new_password': messages}, status=status.HTTP_400_BAD_REQUEST)

            reset_request.user.set_password(new_password)
            reset_request.user.save(update_fields=['password'])

            reset_request.status = PasswordResetRequest.StatusChoices.USED
            reset_request.used_at = timezone.now()
            reset_request.reset_authorization_used_at = timezone.now()
            reset_request.reset_authorization_hash = ''
            reset_request.reset_token_hash = ''
            reset_request.reason = 'Password successfully reset.'
            reset_request.save(update_fields=[
                'status',
                'used_at',
                'reset_authorization_used_at',
                'reset_authorization_hash',
                'reset_token_hash',
                'reason',
            ])
            record_password_recovery_event(
                reset_request,
                PasswordRecoveryAuditEvent.EventType.RESET_COMPLETED,
                PasswordRecoveryAuditEvent.Outcome.SUCCESS,
                reason_code='password_changed',
                actor_type=PasswordRecoveryAuditEvent.ActorType.PORTAL,
            )

        return Response(
            {
                'message': 'Password reset completed successfully.',
                'user_id': reset_request.user.id,
            },
            status=status.HTTP_200_OK,
        )


class DashboardStatisticsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user
        now = timezone.now()

        # Initialize collections and numeric totals to safe defaults so
        # later role-specific branches can override them without
        # causing UnboundLocalError when a variable isn't set.
        upcoming_activities = []
        recent_submissions = []
        recent_access_logs = []
        recent_cabinet_events = []

        total_users = 0
        total_students = 0
        total_activities = 0
        total_submissions = 0
        total_access_logs = 0
        total_cabinet_events = 0
        pending_grading = 0
        submitted_activities = 0
        pending_activities = 0
        overdue_activities = 0
        cabinet_access_today = 0
        # assigned_qs and submission_qs are used for some calculations
        # (overdue etc.) and will be set for students; default to empty
        # querysets to avoid attribute errors.
        assigned_qs = Activity.objects.none()
        submission_qs = Submission.objects.none()

        if user.role == 'admin':
            total_users = User.objects.count()
            total_students = User.objects.filter(role=User.RoleChoices.STUDENT).count()
            total_activities = Activity.objects.count()
            total_submissions = Submission.objects.count()
            total_access_logs = AccessLog.objects.count()
            total_cabinet_events = CabinetEvent.objects.count()

            for log in AccessLog.objects.select_related('user').order_by('-access_time')[:10]:
                recent_access_logs.append({
                    'id': log.id,
                    'status': log.status,
                    'access_time': log.access_time,
                    'user': {
                        'id': log.user.id,
                        'name': f'{log.user.first_name} {log.user.last_name}',
                        'student_id': log.user.student_id,
                    } if log.user else None,
                })

            for event in CabinetEvent.objects.select_related('user').order_by('-timestamp')[:10]:
                recent_cabinet_events.append({
                    'id': event.id,
                    'event_type': event.event_type,
                    'timestamp': event.timestamp,
                    'user': {
                        'id': event.user.id,
                        'name': f'{event.user.first_name} {event.user.last_name}',
                        'student_id': event.user.student_id,
                    } if event.user else None,
                    'details': event.details,
                })

        elif user.role == 'instructor':
            total_activities = Activity.objects.filter(created_by=user).count()
            total_submissions = Submission.objects.filter(activity__created_by=user).count()
            pending_grading = Submission.objects.filter(
                activity__created_by=user,
                score__isnull=True
            ).count()
            total_users = 0
            total_students = 0
            total_access_logs = 0
            total_cabinet_events = 0

            for log in AccessLog.objects.select_related('user').order_by('-access_time')[:10]:
                recent_access_logs.append({
                    'id': log.id,
                    'status': log.status,
                    'access_time': log.access_time,
                    'user': {
                        'id': log.user.id,
                        'name': f'{log.user.first_name} {log.user.last_name}',
                        'student_id': log.user.student_id,
                    } if log.user else None,
                })

            for event in CabinetEvent.objects.select_related('user').order_by('-timestamp')[:10]:
                recent_cabinet_events.append({
                    'id': event.id,
                    'event_type': event.event_type,
                    'timestamp': event.timestamp,
                    'user': {
                        'id': event.user.id,
                        'name': f'{event.user.first_name} {event.user.last_name}',
                        'student_id': event.user.student_id,
                    } if event.user else None,
                    'details': event.details,
                })

        elif user.role == 'student':
            assigned_qs = Activity.objects.filter(
                Q(section=user.section) | Q(assigned_sections=user.section),
                status__iexact=Activity.StatusChoices.PUBLISHED,
            ).distinct() if user.section else Activity.objects.none()
            submission_qs = Submission.objects.filter(student=user)
            total_activities = assigned_qs.count()
            submitted_activities = submission_qs.values_list('activity_id', flat=True).distinct().count()
            pending_activities = assigned_qs.exclude(id__in=submission_qs.values_list('activity_id', flat=True)).count()
            total_access_logs = AccessLog.objects.filter(user=user).count()
            cabinet_access_today = AccessLog.objects.filter(user=user, access_time__date=now.date()).count()
            total_cabinet_events = CabinetEvent.objects.filter(user=user).count()
            total_users = 0
            total_students = 0

            upcoming_qs = assigned_qs.filter(
                Q(due_date__gte=now) | Q(due_date__isnull=True),
            ).select_related('section', 'created_by', 'assigned_instructor').order_by('due_date')[:5]
            for activity in upcoming_qs:
                latest_submission = Submission.objects.filter(activity=activity, student=user).order_by('-submitted_at').first()
                if latest_submission:
                    if latest_submission.score is not None:
                        submission_status = 'Graded'
                    elif activity.due_date and latest_submission.submitted_at and latest_submission.submitted_at > activity.due_date:
                        submission_status = 'Late'
                    else:
                        submission_status = 'Submitted'
                else:
                    submission_status = 'Pending'

                upcoming_activities.append({
                    'id': activity.id,
                    'title': activity.title,
                    'due_date': activity.due_date,
                    'status': submission_status,
                    'instructor_name': f'{(activity.assigned_instructor or activity.created_by).first_name} {(activity.assigned_instructor or activity.created_by).last_name}'.strip() if (activity.assigned_instructor or activity.created_by) else None,
                    'section_name': activity.section.section_name if activity.section else user.section.section_name if user.section else None,
                })

            submission_qs = submission_qs.select_related('activity').order_by('-submitted_at')[:5]
            for submission in submission_qs:
                recent_submissions.append({
                    'id': submission.id,
                    'activity_title': submission.activity.title if submission.activity else None,
                    'submitted_at': submission.submitted_at,
                    'score': submission.score,
                    'status': 'Graded' if submission.score is not None else 'Submitted',
                })

            access_logs_qs = AccessLog.objects.filter(user=user).order_by('-access_time')[:5]
            for log in access_logs_qs:
                recent_access_logs.append({
                    'id': log.id,
                    'status': log.status,
                    'access_time': log.access_time,
                    'cabinet_name': log.cabinet_name,
                    'reason': log.reason,
                })

            cabinet_events_qs = CabinetEvent.objects.filter(user=user).order_by('-timestamp')[:5]
            for event in cabinet_events_qs:
                recent_cabinet_events.append({
                    'id': event.id,
                    'event_type': event.event_type,
                    'timestamp': event.timestamp,
                    'details': event.details,
                })

            pending_grading = pending_activities
            student_profile = {
                'name': f'{user.first_name} {user.last_name}'.strip() or user.username,
                'student_id': user.student_id,
                'section_name': user.section.section_name if user.section else None,
                'profile_image_url': None,
            }
            if user.profile_image:
                try:
                    student_profile['profile_image_url'] = request.build_absolute_uri(user.profile_image.url)
                except ValueError:
                    student_profile['profile_image_url'] = None

        else:
            return Response(
                {'detail': 'Permission denied.'},
                status=status.HTTP_403_FORBIDDEN
            )

        data = {
            'total_users': total_users,
            'total_students': total_students,
            'total_activities': total_activities,
            'submitted_activities': submitted_activities,
            'pending_activities': pending_activities,
            'overdue_activities': assigned_qs.exclude(id__in=submission_qs.values_list('activity_id', flat=True)).filter(due_date__lt=now).count(),
            'total_access_logs': total_access_logs,
            'cabinet_access_today': cabinet_access_today if user.role == 'student' else 0,
            'total_cabinet_events': total_cabinet_events,
            'recent_access_logs': recent_access_logs,
            'recent_cabinet_events': recent_cabinet_events,
            'upcoming_activities': upcoming_activities,
            'recent_submissions': recent_submissions,
        }

        if user.role == 'instructor':
            data['pending_grading'] = pending_grading
        elif user.role == 'student':
            data['pending_activities'] = pending_activities
            data['student_profile'] = student_profile

        return Response(data, status=status.HTTP_200_OK)
