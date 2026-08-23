from django.db import models
from django.db.models import Q
from datetime import timedelta
from rest_framework import viewsets, status, serializers
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication
from .permissions import IsAdminRole, IsDiscussionAuthorOrInstructor, IsInstructorRole, IsStudentRole
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from django_filters import rest_framework as filters
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework_simplejwt.views import TokenObtainPairView
from django.utils import timezone

from .models import Section, User, Activity, ActivityAttachment, Submission, AccessLog, CabinetEvent, Notification, TemporaryUpload, ActivityDiscussion, ActivityAnnouncement
from .models import SubmissionAttachment
from .serializers import (
    SectionSerializer,
    InstructorSectionSerializer,
    UserSerializer,
    ActivitySerializer,
    SubmissionSerializer,
    AccessLogSerializer,
    CabinetEventSerializer,
    NotificationSerializer,
    CustomTokenObtainPairSerializer,
    ActivityDiscussionSerializer,
    ActivityAnnouncementSerializer,
)


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
        if self.action in ['list', 'retrieve']:
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
        queryset = Section.objects.annotate(actual_student_count=models.Count('users', distinct=True))
        if user.role == 'admin':
            return queryset
        if user.role == 'instructor':
            return queryset.filter(instructor=user)
        return Section.objects.none()


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Users.
    Supports full CRUD operations on users with filtering by role and section.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    authentication_classes = [JWTAuthentication]

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'profile', 'update', 'partial_update', 'update_profile', 'change_password', 'upload_profile_image', 'remove_profile_image']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def _instructor_student_filter(self):
        user = self.request.user
        filters = Q(role='student')
        instructor_filters = Q(section__instructor=user)
        return User.objects.filter(filters & instructor_filters).distinct()

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return User.objects.all()
        if user.role == 'instructor':
            return self._instructor_student_filter()
        if user.role == 'student':
            return User.objects.filter(pk=user.pk)
        return User.objects.none()

    @action(detail=False, methods=['get'])
    def profile(self, request):
        serializer = self.get_serializer(request.user, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['patch'])
    def update_profile(self, request):
        user = request.user
        serializer = self.get_serializer(user, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)

        allowed_fields = {'email', 'contact_number'}
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
        filters = Q(activity__created_by=user) | Q(student__section__instructor=user)
        return filters

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return Submission.objects.all()
        elif user.role == 'instructor':
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
            return submission.student.section.instructor == user

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
    status = filters.CharFilter(field_name='status', lookup_expr='iexact')
    user__section = filters.ModelChoiceFilter(field_name='user__section', queryset=Section.objects.all())
    cabinet_name = filters.CharFilter(field_name='cabinet_name', lookup_expr='iexact')
    access_time = filters.DateFromToRangeFilter(field_name='access_time')

    class Meta:
        model = AccessLog
        fields = ['status', 'user__section', 'cabinet_name', 'access_time']


class AccessLogViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Access Logs.
    Returns latest access logs first with filtering by status, section, cabinet, and instructor-owned students.
    """
    queryset = AccessLog.objects.all()
    serializer_class = AccessLogSerializer
    authentication_classes = [JWTAuthentication]
    filter_backends = [filters.DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = AccessLogFilter
    search_fields = ['user__student_id', 'user__first_name', 'user__last_name', 'rfid_tag']
    ordering_fields = ['access_time', 'user__student_id', 'user__last_name', 'cabinet_name']
    ordering = ['-access_time']
    pagination_class = PageNumberPagination

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'stats']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return AccessLog.objects.all()
        if user.role == 'student':
            return AccessLog.objects.filter(user=user)
        if user.role == 'instructor':
            student_filters = Q(user__role=User.RoleChoices.STUDENT)
            instructor_filters = Q(user__section__instructor=user)
            return AccessLog.objects.filter(student_filters & instructor_filters).distinct()
        return AccessLog.objects.none()

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
            # self.get_queryset() already filters to instructor-owned students
            base_qs = self.get_queryset().filter(access_time__date=today)
        elif user.role == 'student':
            base_qs = self.get_queryset().filter(access_time__date=today)
        else:
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        total_accesses = base_qs.count()
        successful = base_qs.filter(status=AccessLog.AccessStatusChoices.SUCCESS).count()
        failed = base_qs.filter(status=AccessLog.AccessStatusChoices.FAILED).count()
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


class CabinetEventViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Cabinet Events.
    Returns latest events first with filtering by event type.
    """
    queryset = CabinetEvent.objects.all()
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
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        nfc_uid = request.data.get('nfc_uid')
        if not nfc_uid:
            return Response(
                {'success': False, 'error': 'NFC UID is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(nfc_uid=nfc_uid).first()

        if user and user.is_active:
            access_log = AccessLog.objects.create(user=user, status=AccessLog.AccessStatusChoices.SUCCESS)
            CabinetEvent.objects.create(
                user=user,
                event_type=CabinetEvent.EventTypeChoices.CABINET_OPENED,
            )
            create_access_log_notifications(access_log)
            return Response(
                {
                    'success': True,
                    'name': f'{user.first_name} {user.last_name}',
                    'role': user.role,
                    'student_id': user.student_id,
                },
                status=status.HTTP_200_OK,
            )

        if user and not user.is_active:
            AccessLog.objects.create(user=user, status=AccessLog.AccessStatusChoices.FAILED)
            return Response(
                {
                    'success': False,
                    'error': 'User account is inactive.',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        AccessLog.objects.create(user=None, status=AccessLog.AccessStatusChoices.FAILED)
        return Response(
            {'success': False, 'error': 'NFC card not registered.'},
            status=status.HTTP_404_NOT_FOUND,
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


