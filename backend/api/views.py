from django.db import models
from django.db import IntegrityError, transaction
from django.db.models import Q
from datetime import timedelta
from rest_framework import mixins, viewsets, status, serializers
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication
from .permissions import (
    IsAdminRole, IsDiscussionAuthorOrInstructor, IsInstructorRole,
    IsStudentRole, HasDeviceAPIKey, PasswordResetRateThrottle,
    CanReadAccessLogPhoto,
    CanReadAccessLogPhotoImage,
)
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from django_filters import rest_framework as filters
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework_simplejwt.views import TokenObtainPairView
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.http import FileResponse
from django.urls import reverse
from django.utils.cache import patch_cache_control
from django.conf import settings
from PIL import Image, UnidentifiedImageError
from urllib.parse import quote
import hashlib

from .models import Section, User, Activity, ActivityAttachment, Submission, AccessLog, AccessLogPhoto, CabinetSession, CabinetEvent, Notification, TemporaryUpload, ActivityDiscussion, ActivityAnnouncement
from .models import SubmissionAttachment
from .models import PasswordResetRequest, NFCEnrollmentSession
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
    PasswordResetNFCVerificationSerializer,
    PasswordResetCabinetHandoffSerializer,
    CabinetRegistrationSerializer,
    PasswordResetConfirmationSerializer,
    PasswordResetTokenValidationSerializer,
    NFCEnrollmentRegistrationSerializer,
    AccessLogPhotoReadSerializer,
)
from django.contrib.auth.password_validation import validate_password
import secrets
import logging

logger = logging.getLogger(__name__)
MAX_ACCESS_LOG_PHOTO_BYTES = 5 * 1024 * 1024
MAX_ACCESS_LOG_PHOTO_PIXELS = 20_000_000


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
            'image_available': image_available if not student_status_only else False,
            'image_endpoint': reverse('access_log_photo_image', args=[access_log.pk])
            if image_available and not student_status_only else None,
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


class AccessLogPhotoImageView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [CanReadAccessLogPhotoImage]

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

    def get_serializer_class(self):
        user = getattr(self.request, 'user', None)
        if getattr(user, 'role', None) == 'instructor':
            return InstructorSectionSerializer
        return SectionSerializer

    def _instructor_section_filter(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return Section.objects.none()

        return Section.objects.filter(instructor=user)

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
            'access_logs': AccessLogSerializer(access_logs[:5], many=True, context=context).data,
            'cabinet_stations': cabinet_stations,
        })


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Users.
    Supports full CRUD operations on users with filtering by role and section.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    authentication_classes = [JWTAuthentication]

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'profile', 'access_logs', 'update', 'partial_update', 'update_profile', 'change_password', 'upload_profile_image', 'remove_profile_image']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

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
        current_password = request.data.get('current_password', '')
        new_password = request.data.get('new_password', '')
        confirm_password = request.data.get('confirm_password', '')

        if not user.check_password(current_password):
            return Response({'current_password': ['Current password is incorrect.']}, status=status.HTTP_400_BAD_REQUEST)

        if new_password != confirm_password:
            return Response({'confirm_password': ['New password and confirmation do not match.']}, status=status.HTTP_400_BAD_REQUEST)

        if not new_password or len(new_password) < 8:
            return Response({'new_password': ['New password must be at least 8 characters.']}, status=status.HTTP_400_BAD_REQUEST)

        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(new_password, user=user)
        except Exception as password_error:
            errors = []
            if hasattr(password_error, 'messages'):
                errors = password_error.messages
            else:
                errors = [str(password_error)]
            return Response({'new_password': errors}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()
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
    - Admins can view/manage all activities
    - Instructors can create activities and manage only their own
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

    def get_queryset(self):
        user = self.request.user
        base_qs = Activity.objects.select_related('created_by', 'section').prefetch_related('attachments')
        annotated_qs = base_qs.annotate(
            submitted_students_count=models.Count('submissions__student', distinct=True),
            assigned_student_count=models.Count('section__users', distinct=True),
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
            return annotated_qs.filter(section=user.section)
        return Activity.objects.none()

    @action(detail=False, methods=['get'])
    def stats(self, request):
        user = request.user
        if user.role != 'student':
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        assigned_qs = Activity.objects.filter(section=user.section) if user.section else Activity.objects.none()
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
            return [IsAuthenticated(), IsInstructorRole()]
        else:
            return [IsAuthenticated(), IsAdminRole()]

    def perform_create(self, serializer):
        activity = serializer.save(created_by=self.request.user)
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
        activity = serializer.save()
        for student in get_activity_students(activity):
            create_student_notification(
                student,
                'Activity updated',
                f'{activity.title} has been updated by your instructor.',
                Notification.TypeChoices.ACTIVITY,
                f'activity-update-{activity.id}-{student.id}-{activity.updated_at.isoformat()}',
                '/student/activities',
            )

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
    filter_backends = [filters.DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['activity']
    ordering_fields = ['created_at']
    ordering = ['created_at']

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return ActivityDiscussion.objects.none()
        # Students and instructors can see discussions for activities in their section
        if user.role == 'admin':
            queryset = ActivityDiscussion.objects.select_related('sender', 'activity')
        elif user.role == 'instructor':
            queryset = ActivityDiscussion.objects.filter(activity__section__instructor=user).select_related('sender', 'activity')
        elif user.role == 'student':
            if not user.section:
                return ActivityDiscussion.objects.none()
            queryset = ActivityDiscussion.objects.filter(activity__section=user.section).select_related('sender', 'activity')
        else:
            return ActivityDiscussion.objects.none()
        return queryset.order_by('created_at')

    def perform_create(self, serializer):
        user = self.request.user
        role = getattr(user, 'role', '')
        discussion = serializer.save(sender=user, sender_role=role)
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
        serializer.save()


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
            return queryset.filter(activity__section=user.section)
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

    class Meta:
        model = Submission
        fields = ['activity', 'student__section', 'submitted_at']

    def filter_status(self, queryset, name, value):
        value = str(value).lower().strip()
        if value == 'graded':
            return queryset.filter(score__isnull=False)
        if value == 'submitted':
            return queryset.filter(score__isnull=True, activity__due_date__gte=models.F('submitted_at'))
        if value == 'late':
            return queryset.filter(score__isnull=True, activity__due_date__lt=models.F('submitted_at'))
        if value == 'missing':
            return queryset.filter(score__isnull=True, activity__due_date__lt=timezone.now(), submitted_at__isnull=True)
        return queryset


class SubmissionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Submissions.
    - Students can create submissions
    - Instructors can view submissions for their activities and grade them
    - Admins can view/manage all submissions
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
            return Submission.objects.filter(student=user).select_related('activity')
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
        elif self.action in ['update', 'partial_update', 'grade', 'stats']:
            return [IsAuthenticated()]
        else:
            return [IsAuthenticated()]

    def perform_create(self, serializer):
        student = self.request.user
        activity = serializer.validated_data.get('activity')
        if activity is None:
            raise serializers.ValidationError({'activity': 'Activity is required.'})

        last_attempt = Submission.objects.filter(activity=activity, student=student).order_by('-attempt').first()
        submission = serializer.save(student=student, attempt=(last_attempt.attempt + 1 if last_attempt else 1))
        create_submission_notifications(submission)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return submissions summary counts for the current user.

        Response keys are shaped for the frontend: `totalSubmissions`,
        `pendingReview`, `graded`, `lateSubmissions`.
        """
        user = request.user
        if user.role == 'admin':
            base_qs = Submission.objects.all()
        elif user.role == 'instructor':
            base_qs = Submission.objects.filter(models.Q(activity__created_by=user) | models.Q(student__section__instructor=user))
        elif user.role == 'student':
            base_qs = Submission.objects.filter(student=user)
        else:
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        total = base_qs.count()
        graded = base_qs.filter(score__isnull=False).count()
        pending = base_qs.filter(score__isnull=True).count()
        late = base_qs.filter(score__isnull=True, activity__due_date__lt=models.F('submitted_at')).count()

        return Response({
            'totalSubmissions': total,
            'pendingReview': pending,
            'graded': graded,
            'lateSubmissions': late,
        })

    @action(detail=True, methods=['post'])
    def grade(self, request, pk=None):
        """Grade a submission and update the existing record in place."""
        submission = self.get_object()

        if request.user.role == 'instructor' and submission.activity.created_by != request.user:
            return Response(
                {'detail': 'Permission denied. You can only grade submissions for your own activities.'},
                status=status.HTTP_403_FORBIDDEN
            )
        if request.user.role not in ['instructor', 'admin']:
            return Response(
                {'detail': 'Only instructors and admins can grade submissions.'},
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
                'name': up.file.name.split('/')[-1],
                'size': up.file.size if hasattr(up.file, 'size') else None,
                'uploaded_at': up.uploaded_at,
                'url': request.build_absolute_uri(up.file.url) if request else up.file.url,
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
        up = TemporaryUpload.objects.create(user=request.user, file=file, activity=activity)
        data = {
            'id': up.id,
            'name': up.file.name.split('/')[-1],
            'size': up.file.size if hasattr(up.file, 'size') else None,
            'uploaded_at': up.uploaded_at,
            'url': request.build_absolute_uri(up.file.url) if request else up.file.url,
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
        activity = None
        if activity_id:
            try:
                activity = Activity.objects.get(pk=activity_id)
            except Activity.DoesNotExist:
                activity = None

        if not files:
            # also allow single file field 'file'
            single = request.FILES.get('file')
            if single:
                files = [single]

        if not files:
            return Response({'detail': 'No files uploaded.'}, status=status.HTTP_400_BAD_REQUEST)

        results = []
        for f in files:
            up = TemporaryUpload.objects.create(user=request.user, file=f, activity=activity)
            results.append({
                'id': up.id,
                'name': up.file.name.split('/')[-1],
                'size': up.file.size if hasattr(up.file, 'size') else None,
                'uploaded_at': up.uploaded_at,
                'url': request.build_absolute_uri(up.file.url) if request else up.file.url,
            })

        return Response({'uploads': results}, status=status.HTTP_201_CREATED)


class AccessLogFilter(filters.FilterSet):
    status = filters.CharFilter(method='filter_access_result')
    action = filters.CharFilter(field_name='action', lookup_expr='iexact')
    student_id = filters.CharFilter(field_name='user__student_id', lookup_expr='iexact')
    user__section = filters.ModelChoiceFilter(field_name='user__section', queryset=Section.objects.all())
    station = filters.CharFilter(field_name='station', lookup_expr='iexact')
    nfc_uid = filters.CharFilter(field_name='nfc_uid', lookup_expr='icontains')
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


class AccessLogPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class AccessLogSearchFilter(SearchFilter):
    def get_search_fields(self, view, request):
        fields = super().get_search_fields(view, request)
        if request.user.role == User.RoleChoices.INSTRUCTOR:
            return [*fields, 'cabinet_name']
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
            return CabinetSession.objects.filter(station__isnull=False) if user.is_authenticated else CabinetSession.objects.none()
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

    def _unregistered_response(self, nfc_uid, device_context):
        access_log = self._create_scan_log(
            nfc_uid,
            user=None,
            access_status=AccessLog.AccessStatusChoices.UNREGISTERED,
            reason='NFC UID is not registered',
            device_context=device_context,
        )
        token = secrets.token_urlsafe(32)
        expires_at = timezone.now() + timedelta(minutes=15)
        with transaction.atomic():
            enrollment = NFCEnrollmentSession.objects.select_for_update().filter(
                nfc_uid=nfc_uid,
                status=NFCEnrollmentSession.StatusChoices.PENDING,
            ).order_by('-created_at').first()
            if enrollment and enrollment.is_expired:
                enrollment.status = NFCEnrollmentSession.StatusChoices.EXPIRED
                enrollment.save(update_fields=['status'])
                enrollment = None
            if enrollment is None:
                enrollment = NFCEnrollmentSession(
                    nfc_uid=nfc_uid,
                    token_digest='',
                    token_hash='',
                    expires_at=expires_at,
                )
            else:
                enrollment.expires_at = expires_at
            active_session = self._active_session_for_user(None, device_context)
            enrollment.station = (active_session.station if active_session else '') or device_context.get('station') or ''
            enrollment.cabinet_name = device_context.get('cabinet_name') or settings.TAPTRACK_CABINET_NAME
            enrollment.set_token(token)
            enrollment.save()
        registration_url = f'{settings.NFC_REGISTRATION_URL_BASE}?token={quote(token, safe="")}'
        return Response(
            {
                **self._event_payload(access_log),
                'success': False,
                'registered': False,
                'registration_required': True,
                'registration_url': registration_url,
                'expires_at': enrollment.expires_at.isoformat(),
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


class NFCEnrollmentValidationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        token = (request.query_params.get('token') or '').strip()
        if not token:
            return Response(
                {'valid': False, 'error': 'This NFC registration session is invalid or expired.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        enrollment = NFCEnrollmentSession.objects.filter(token_digest=token_digest).first()
        if not enrollment or enrollment.status != NFCEnrollmentSession.StatusChoices.PENDING:
            return Response(
                {'valid': False, 'error': 'This NFC registration session is invalid or expired.'},
                status=status.HTTP_410_GONE,
            )

        if enrollment.is_expired:
            enrollment.status = NFCEnrollmentSession.StatusChoices.EXPIRED
            enrollment.save(update_fields=['status'])
            return Response(
                {'valid': False, 'error': 'This NFC registration session is invalid or expired.'},
                status=status.HTTP_410_GONE,
            )

        return Response(
            {'valid': True, 'expires_at': enrollment.expires_at.isoformat()},
            status=status.HTTP_200_OK,
        )


class NFCEnrollmentRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = NFCEnrollmentRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        token = data['token'].strip()
        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()

        with transaction.atomic():
            enrollment = NFCEnrollmentSession.objects.select_for_update().filter(
                token_digest=token_digest,
            ).first()
            if not enrollment or enrollment.status != NFCEnrollmentSession.StatusChoices.PENDING:
                return Response(
                    {'error': 'This NFC registration session is invalid or expired.'},
                    status=status.HTTP_410_GONE,
                )
            if enrollment.is_expired:
                enrollment.status = NFCEnrollmentSession.StatusChoices.EXPIRED
                enrollment.save(update_fields=['status'])
                return Response(
                    {'error': 'This NFC registration session is invalid or expired.'},
                    status=status.HTTP_410_GONE,
                )

            user = User.objects.select_for_update().filter(
                student_id=data['student_id'].strip(),
                role=User.RoleChoices.STUDENT,
            ).first()
            if not user:
                return Response(
                    {'error': 'Student ID was not found in the existing student records.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if user.has_usable_password() or user.nfc_uid:
                return Response(
                    {'error': 'A TapTrack account already exists for this Student ID.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if User.objects.filter(nfc_uid=enrollment.nfc_uid).exclude(pk=user.pk).exists():
                return Response(
                    {'error': 'This NFC card is already assigned to another student.'},
                    status=status.HTTP_409_CONFLICT,
                )
            email = data['email'].strip().lower()
            if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                return Response(
                    {'error': 'That email address is already in use.'},
                    status=status.HTTP_409_CONFLICT,
                )

            name_parts = data['full_name'].strip().split(None, 1)
            user.first_name = name_parts[0]
            user.last_name = name_parts[1] if len(name_parts) > 1 else ''
            user.email = email
            user.nfc_uid = enrollment.nfc_uid
            user.is_active = True
            user.set_password(data['password'])
            user.full_clean()
            user.save()

            enrollment.status = NFCEnrollmentSession.StatusChoices.COMPLETED
            enrollment.completed_at = timezone.now()
            enrollment.completed_by = user
            enrollment.save(update_fields=['status', 'completed_at', 'completed_by'])
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
                'student_id': user.student_id,
                'name': user.get_full_name().strip(),
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
        student_id = data['student_id'].strip()
        nfc_uid = data['nfc_uid'].strip().upper()
        email = data['email'].strip().lower()

        if User.objects.filter(student_id=student_id).exists():
            return Response({'error': 'Student ID is already registered.'}, status=status.HTTP_409_CONFLICT)
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
        user = User(
            username=student_id,
            student_id=student_id,
            email=email,
            first_name=name_parts[0],
            last_name=name_parts[1] if len(name_parts) > 1 else '',
            role=User.RoleChoices.STUDENT,
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
            return Response({'error': 'Student registration could not be completed.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'id': user.id,
            'student_id': user.student_id,
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
        student_id = (request.data.get('student_id') or '').strip()
        email = (request.data.get('email') or '').strip()

        if not student_id or not email:
            return Response(
                {'error': 'Student ID and email are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(student_id=student_id, email__iexact=email).first()
        if not user:
            return Response(
                {'error': 'No account matches that student ID and email.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        reset_request = PasswordResetRequest.objects.filter(user=user, status__in=[
            PasswordResetRequest.StatusChoices.PENDING,
            PasswordResetRequest.StatusChoices.VERIFIED,
        ]).order_by('-requested_at').first()

        if reset_request and not reset_request.is_expired and reset_request.status != PasswordResetRequest.StatusChoices.USED:
            reset_request.status = PasswordResetRequest.StatusChoices.CANCELLED
            reset_request.reason = 'Replaced by a newer reset request.'
            reset_request.save(update_fields=['status', 'reason'])

        reset_request = PasswordResetRequest.objects.create(
            user=user,
            student_id_snapshot=user.student_id or '',
            email_snapshot=user.email or '',
            status=PasswordResetRequest.StatusChoices.PENDING,
        )
        reset_request.expires_at = timezone.now() + timedelta(minutes=15)
        reset_request.save(update_fields=['expires_at'])

        return Response(
            {
                'message': 'Password reset request created.',
                'request_id': reset_request.request_id,
                'expires_at': reset_request.expires_at.isoformat(),
                'user_id': user.id,
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetVerifyNFCView(APIView):
    authentication_classes = []
    permission_classes = [HasDeviceAPIKey]

    def post(self, request, *args, **kwargs):
        serializer = PasswordResetNFCVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request_id = serializer.validated_data['request_id']
        student_id = serializer.validated_data['student_id']
        nfc_uid = serializer.validated_data['nfc_uid']

        reset_request = PasswordResetRequest.objects.filter(request_id=request_id).select_related('user').first()
        if not reset_request:
            return Response({'error': 'Reset request not found.'}, status=status.HTTP_404_NOT_FOUND)

        if reset_request.user_id is None:
            return Response({'error': 'Reset request is invalid.'}, status=status.HTTP_400_BAD_REQUEST)

        if reset_request.is_expired:
            reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
            reset_request.save(update_fields=['status'])
            return Response({'error': 'This reset request has expired.'}, status=status.HTTP_410_GONE)

        if reset_request.status == PasswordResetRequest.StatusChoices.USED:
            return Response({'error': 'This reset request has already been used.'}, status=status.HTTP_409_CONFLICT)

        if not reset_request.cabinet_handoff_claimed_at or reset_request.cabinet_handoff_used_at:
            return Response({'error': 'This reset request is not ready for cabinet verification.'}, status=status.HTTP_409_CONFLICT)

        if not reset_request.cabinet_handoff_expires_at or timezone.now() > reset_request.cabinet_handoff_expires_at:
            reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
            reset_request.save(update_fields=['status'])
            return Response({'error': 'This cabinet handoff has expired.'}, status=status.HTTP_410_GONE)

        user = reset_request.user
        if user.student_id != student_id:
            return Response({'error': 'Student ID does not match the reset request.'}, status=status.HTTP_403_FORBIDDEN)

        if user.nfc_uid != nfc_uid:
            return Response({'error': 'NFC UID does not match the account for this reset request.'}, status=status.HTTP_403_FORBIDDEN)

        if not user.is_active:
            return Response({'error': 'This account is inactive and cannot reset its password.'}, status=status.HTTP_403_FORBIDDEN)

        reset_token = secrets.token_urlsafe(32)
        reset_request.set_reset_token(reset_token)
        reset_request.status = PasswordResetRequest.StatusChoices.VERIFIED
        reset_request.nfc_uid_verified = True
        reset_request.verified_at = timezone.now()
        reset_request.save(update_fields=['reset_token_hash', 'status', 'nfc_uid_verified', 'verified_at'])

        reset_request.cabinet_handoff_used_at = timezone.now()
        reset_request.save(update_fields=['cabinet_handoff_used_at'])

        return Response(
            {
                'message': 'Identity verified by cabinet NFC.',
                'request_id': reset_request.request_id,
                'reset_token': reset_token,
                'expires_at': reset_request.expires_at.isoformat(),
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
                    return Response({'error': 'Reset request is already active at the cabinet.'}, status=status.HTTP_409_CONFLICT)
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

        return Response(
            {
                'request_id': reset_request.request_id,
                'student_id': reset_request.student_id_snapshot,
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
                status=PasswordResetRequest.StatusChoices.VERIFIED,
                request_id=request_id,
            ).select_related('user').first()

            if not reset_request:
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_400_BAD_REQUEST)

            if reset_request.is_expired or not reset_request.reset_authorization_expires_at:
                reset_request.status = PasswordResetRequest.StatusChoices.EXPIRED
                reset_request.save(update_fields=['status'])
                return Response({'error': 'Reset authorization is invalid or expired.'}, status=status.HTTP_410_GONE)

            if reset_request.reset_authorization_used_at:
                return Response({'error': 'Reset authorization has already been used.'}, status=status.HTTP_409_CONFLICT)

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
            assigned_qs = Activity.objects.filter(section=user.section)
            submission_qs = Submission.objects.filter(student=user)
            total_activities = assigned_qs.count()
            submitted_activities = submission_qs.values_list('activity_id', flat=True).distinct().count()
            pending_activities = assigned_qs.exclude(id__in=submission_qs.values_list('activity_id', flat=True)).count()
            total_access_logs = AccessLog.objects.filter(user=user).count()
            cabinet_access_today = AccessLog.objects.filter(user=user, access_time__date=now.date()).count()
            total_cabinet_events = CabinetEvent.objects.filter(user=user).count()
            total_users = 0
            total_students = 0

            upcoming_qs = assigned_qs.filter(due_date__gte=now).order_by('due_date')[:5]
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
                    'instructor_name': f'{activity.created_by.first_name if activity.created_by else ""} {activity.created_by.last_name if activity.created_by else ""}'.strip(),
                    'section_name': activity.section.section_name if activity.section else None,
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


