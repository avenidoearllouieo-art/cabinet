from django.utils import timezone
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers
from django.core.files.uploadedfile import UploadedFile, InMemoryUploadedFile, TemporaryUploadedFile
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import (
    Section,
    User,
    Activity,
    ActivityAttachment,
    Submission,
    AccessLog,
    CabinetEvent,
    CabinetSession,
    Notification,
    TemporaryUpload,
    SubmissionAttachment,
    ActivityDiscussion,
    ActivityAnnouncement,
    PasswordResetRequest,
)


def sync_section_owner(section, instructor):
    """Keep the legacy Section owner and instructor M2M relationship consistent."""
    through_model = User.assigned_sections.through
    through_model.objects.filter(section_id=section.pk).exclude(
        user_id=getattr(instructor, 'pk', None)
    ).delete()
    if instructor:
        through_model.objects.get_or_create(user_id=instructor.pk, section_id=section.pk)


def sync_instructor_sections(instructor, sections):
    """Treat the supplied section list as the instructor's authoritative assignment."""
    selected = list(sections)
    selected_ids = [section.pk for section in selected]
    through_model = User.assigned_sections.through

    if selected_ids:
        through_model.objects.filter(section_id__in=selected_ids).exclude(user_id=instructor.pk).delete()

    instructor.assigned_sections.set(selected)
    Section.objects.filter(instructor=instructor).exclude(pk__in=selected_ids).update(instructor=None)
    if selected_ids:
        Section.objects.filter(pk__in=selected_ids).update(instructor=instructor)


def represent_assigned_section(section):
    return {
        'section_id': section.section_id,
        'section_name': section.section_name,
        'subject_code': section.subject_code,
        'program': section.program,
        'year_level': section.year_level,
        'academic_year': section.academic_year,
    }


class AssignedSectionField(serializers.PrimaryKeyRelatedField):
    """Accept section IDs on write and preserve the existing object shape on read."""

    def to_representation(self, value):
        return represent_assigned_section(value)


class SectionInstructorSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    profile_image_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'full_name', 'role', 'instructor_id', 'email', 'contact_number', 'profile_image_url']
        read_only_fields = fields

    def get_full_name(self, obj):
        return obj.get_full_name().strip()

    def get_profile_image_url(self, obj):
        if not obj.profile_image:
            return None
        try:
            image_url = obj.profile_image.url
        except ValueError:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(image_url) if request else image_url


class SectionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='section_id', read_only=True)
    instructor = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.RoleChoices.INSTRUCTOR),
        required=False,
        allow_null=True
    )
    instructor_name = serializers.SerializerMethodField()
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = Section
        fields = [
            'id',
            'section_id',
            'subject_code',
            'section_name',
            'program',
            'year_level',
            'academic_year',
            'instructor',
            'instructor_name',
            'student_count',
            'status',
        ]

    def get_instructor_name(self, obj):
        if obj.instructor:
            return f"{obj.instructor.first_name} {obj.instructor.last_name}".strip() or obj.instructor.username
        return None

    def get_student_count(self, obj):
        if hasattr(obj, 'actual_student_count'):
            return int(obj.actual_student_count or 0)
        return obj.users.count()

    @transaction.atomic
    def create(self, validated_data):
        section = super().create(validated_data)
        sync_section_owner(section, section.instructor)
        return section

    @transaction.atomic
    def update(self, instance, validated_data):
        section = super().update(instance, validated_data)
        sync_section_owner(section, section.instructor)
        return section


class InstructorSectionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='section_id', read_only=True)
    student_count = serializers.SerializerMethodField()
    instructor_name = serializers.SerializerMethodField()
    activity_count = serializers.SerializerMethodField()
    submitted_count = serializers.SerializerMethodField()
    expected_submission_count = serializers.SerializerMethodField()
    missing_count = serializers.SerializerMethodField()
    pending_review_count = serializers.SerializerMethodField()
    latest_activity_title = serializers.SerializerMethodField()
    last_activity_at = serializers.SerializerMethodField()
    cabinet_station = serializers.SerializerMethodField()

    class Meta:
        model = Section
        fields = [
            'id',
            'section_id',
            'subject_code',
            'section_name',
            'program',
            'year_level',
            'academic_year',
            'instructor_name',
            'student_count',
            'activity_count',
            'submitted_count',
            'expected_submission_count',
            'missing_count',
            'pending_review_count',
            'latest_activity_title',
            'last_activity_at',
            'cabinet_station',
            'status',
        ]

    def _metrics(self, obj):
        metrics = self.context.setdefault('_instructor_section_metrics', {})
        if obj.pk not in metrics:
            activities = list(
                Activity.objects.filter(Q(section=obj) | Q(assigned_sections=obj))
                .distinct()
                .order_by('-updated_at', '-created_at')
            )
            activity_ids = [activity.pk for activity in activities]
            student_count = obj.users.filter(role=User.RoleChoices.STUDENT).count()
            section_submissions = Submission.objects.filter(
                student__section=obj,
                activity_id__in=activity_ids,
            )
            submitted_count = section_submissions.values('student_id', 'activity_id').distinct().count()
            expected_count = student_count * len(activity_ids)
            metrics[obj.pk] = {
                'student_count': student_count,
                'activity_count': len(activities),
                'submitted_count': submitted_count,
                'expected_submission_count': expected_count,
                'missing_count': max(0, expected_count - submitted_count),
                'pending_review_count': section_submissions.filter(score__isnull=True).count(),
                'latest_activity': activities[0] if activities else None,
                'cabinet_station': next((activity.cabinet_station for activity in activities if activity.cabinet_station), ''),
            }
        return metrics[obj.pk]

    def get_student_count(self, obj):
        return self._metrics(obj)['student_count']

    def get_instructor_name(self, obj):
        instructor = obj.instructor
        if not instructor:
            request = self.context.get('request')
            current_user = getattr(request, 'user', None)
            if current_user and current_user.is_authenticated and current_user.role == User.RoleChoices.INSTRUCTOR:
                if obj.assigned_instructors.filter(pk=current_user.pk).exists():
                    instructor = current_user
        return instructor.get_full_name().strip() or instructor.username if instructor else None

    def get_activity_count(self, obj):
        return self._metrics(obj)['activity_count']

    def get_submitted_count(self, obj):
        return self._metrics(obj)['submitted_count']

    def get_expected_submission_count(self, obj):
        return self._metrics(obj)['expected_submission_count']

    def get_missing_count(self, obj):
        return self._metrics(obj)['missing_count']

    def get_pending_review_count(self, obj):
        return self._metrics(obj)['pending_review_count']

    def get_latest_activity_title(self, obj):
        activity = self._metrics(obj)['latest_activity']
        return activity.title if activity else None

    def get_last_activity_at(self, obj):
        activity = self._metrics(obj)['latest_activity']
        return activity.updated_at if activity else None

    def get_cabinet_station(self, obj):
        return self._metrics(obj)['cabinet_station']


class UserSerializer(serializers.ModelSerializer):
    section_name = serializers.CharField(source='section.section_name', read_only=True)
    section_program = serializers.CharField(source='section.program', read_only=True)
    section_year_level = serializers.CharField(source='section.year_level', read_only=True)
    section_academic_year = serializers.CharField(source='section.academic_year', read_only=True)
    attendance_present_count = serializers.SerializerMethodField()
    attendance_absent_count = serializers.SerializerMethodField()
    attendance_percentage = serializers.SerializerMethodField()
    profile_image_url = serializers.SerializerMethodField()
    assigned_sections = AssignedSectionField(
        queryset=Section.objects.all(),
        many=True,
        required=False,
    )
    last_access_status = serializers.SerializerMethodField()
    last_access_time = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'instructor_id',
            'id',
            'student_id',
            'username',
            'first_name',
            'last_name',
            'email',
            'contact_number',
            'role',
            'section',
            'assigned_sections',
            'is_active',
            'password',
            'profile_image',
            'profile_image_url',
            'section_name',
            'section_program',
            'section_year_level',
            'section_academic_year',
            'nfc_uid',
            'attendance_present_count',
            'attendance_absent_count',
            'attendance_percentage',
            'last_access_status',
            'last_access_time',
            'created_at',
            'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'password': {'write_only': True, 'required': False},
            'profile_image': {'required': False, 'allow_null': True},
            'email': {'required': False},
            'contact_number': {'required': False},
        }

    def get_profile_image_url(self, obj):
        if not obj.profile_image:
            return None
        request = self.context.get('request')
        try:
            url = obj.profile_image.url
        except ValueError:
            return None
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_last_access_status(self, obj):
        last_log = obj.access_logs.order_by('-access_time').first()
        if not last_log:
            return None
        return last_log.status

    def get_last_access_time(self, obj):
        last_log = obj.access_logs.order_by('-access_time').first()
        if not last_log:
            return None
        request = self.context.get('request')
        try:
            return last_log.access_time.isoformat()
        except Exception:
            return None

    def validate(self, attrs):
        role = attrs.get('role', getattr(self.instance, 'role', User.RoleChoices.STUDENT))
        assigned_sections = attrs.get('assigned_sections')
        if role != User.RoleChoices.INSTRUCTOR and assigned_sections:
            raise serializers.ValidationError({
                'assigned_sections': 'Only instructors can be assigned to sections.'
            })
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.role != User.RoleChoices.INSTRUCTOR:
            data['assigned_sections'] = []
        elif not data['assigned_sections']:
            # Older rows may only have the Section.instructor relationship.
            # Preserve those assignments in responses until the next write
            # synchronizes both sides of the relationship.
            data['assigned_sections'] = [
                represent_assigned_section(section)
                for section in instance.instructor_sections.all()
            ]
        return data

    @transaction.atomic
    def create(self, validated_data):
        assigned_sections = validated_data.pop('assigned_sections', [])
        password = validated_data.pop('password', None)
        user = super().create(validated_data)
        if password:
            user.set_password(password)
            user.save()
        if user.role == User.RoleChoices.INSTRUCTOR:
            sync_instructor_sections(user, assigned_sections)
        return user

    @transaction.atomic
    def update(self, instance, validated_data):
        assigned_sections = validated_data.pop('assigned_sections', serializers.empty)
        password = validated_data.pop('password', None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save()
        if user.role == User.RoleChoices.INSTRUCTOR:
            if assigned_sections is not serializers.empty:
                sync_instructor_sections(user, assigned_sections)
        else:
            sync_instructor_sections(user, [])
        return user

    def get_attendance_present_count(self, obj):
        return obj.access_logs.filter(status='success').count()

    def get_attendance_absent_count(self, obj):
        return obj.access_logs.filter(status='failed').count()

    def get_attendance_percentage(self, obj):
        total_logs = obj.access_logs.count()
        if total_logs == 0:
            return 0
        present = obj.access_logs.filter(status='success').count()
        return round((present / total_logs) * 100)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    expected_role = serializers.CharField(write_only=True, required=False, allow_blank=True)

    def validate(self, attrs):
        expected_role = attrs.pop('expected_role', '').strip().lower()
        data = super().validate(attrs)
        data['user'] = {
            'id': self.user.id,
            'username': self.user.username,
            'email': self.user.email,
            'role': self.user.role,
        }
        self.expected_role = expected_role
        return data


class PasswordResetRequestSerializer(serializers.ModelSerializer):
    student_id = serializers.CharField(required=True, allow_blank=False)
    email = serializers.EmailField(required=True)

    class Meta:
        model = PasswordResetRequest
        fields = ['request_id', 'user', 'student_id_snapshot', 'email_snapshot', 'status', 'requested_at', 'expires_at']
        read_only_fields = ['request_id', 'user', 'student_id_snapshot', 'email_snapshot', 'status', 'requested_at', 'expires_at']


class PasswordResetNFCVerificationSerializer(serializers.Serializer):
    request_id = serializers.CharField(required=True, allow_blank=False)
    student_id = serializers.CharField(required=True, allow_blank=False)
    nfc_uid = serializers.CharField(required=True, allow_blank=False)


class PasswordResetCabinetHandoffSerializer(serializers.Serializer):
    request_id = serializers.CharField(required=True, allow_blank=False)


class CabinetRegistrationSerializer(serializers.Serializer):
    full_name = serializers.CharField(required=True, allow_blank=False, max_length=150)
    student_id = serializers.CharField(required=True, allow_blank=False, max_length=50)
    email = serializers.EmailField(required=True)
    section = serializers.CharField(required=False, allow_blank=True, max_length=100)
    nfc_uid = serializers.CharField(required=True, allow_blank=False, max_length=100)


class PasswordResetConfirmationSerializer(serializers.Serializer):
    request_id = serializers.CharField(required=True, allow_blank=False)
    reset_authorization = serializers.CharField(required=True, allow_blank=False)
    new_password = serializers.CharField(required=True, write_only=True)
    confirm_password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        new_password = attrs.get('new_password')
        confirm_password = attrs.get('confirm_password')

        if new_password != confirm_password:
            raise serializers.ValidationError({'confirm_password': 'New password and confirmation do not match.'})

        if not new_password or len(new_password) < 8:
            raise serializers.ValidationError({'new_password': 'New password must be at least 8 characters.'})

        return attrs


class PasswordResetTokenValidationSerializer(serializers.Serializer):
    request_id = serializers.CharField(required=True, allow_blank=False)
    reset_token = serializers.CharField(required=True, allow_blank=False, write_only=True)


class NFCEnrollmentRegistrationSerializer(serializers.Serializer):
    token = serializers.CharField(required=True, allow_blank=False, write_only=True)
    student_id = serializers.CharField(required=True, allow_blank=False, max_length=50)
    full_name = serializers.CharField(required=True, allow_blank=False, max_length=150)
    email = serializers.EmailField(required=True)
    password = serializers.CharField(required=True, write_only=True, min_length=8)
    confirm_password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        if attrs['password'] != attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'Passwords do not match.'})
        return attrs


class ActivityAttachmentSerializer(serializers.ModelSerializer):
    filename = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()
    size = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ActivityAttachment
        fields = ['id', 'filename', 'url', 'size', 'uploaded_at', 'file_name', 'file_size', 'download_url']
        read_only_fields = ['id', 'filename', 'url', 'size', 'uploaded_at', 'file_name', 'file_size', 'download_url']

    def get_filename(self, obj):
        return obj.original_filename or obj.file.name.split('/')[-1]

    def get_url(self, obj):
        request = self.context.get('request')
        try:
            url = obj.file.url
        except ValueError:
            return None
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_size(self, obj):
        return obj.file_size or obj.file.size

    def get_file_name(self, obj):
        return self.get_filename(obj)

    def get_file_size(self, obj):
        return self.get_size(obj)

    def get_download_url(self, obj):
        return self.get_url(obj)


class SubmissionAttachmentSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = SubmissionAttachment
        fields = ['id', 'file', 'file_name', 'file_size', 'download_url', 'uploaded_at']
        read_only_fields = ['id', 'file_name', 'file_size', 'download_url', 'uploaded_at']

    def get_file_name(self, obj):
        return obj.file.name.split('/')[-1]

    def get_file_size(self, obj):
        return obj.file.size

    def get_download_url(self, obj):
        request = self.context.get('request')
        try:
            url = obj.file.url
        except ValueError:
            return None
        if request:
            return request.build_absolute_uri(url)
        return url


class ActivitySerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.first_name', read_only=True)
    created_by_last_name = serializers.CharField(source='created_by.last_name', read_only=True)
    section_name = serializers.CharField(source='section.section_name', read_only=True)
    instructor_name = serializers.SerializerMethodField()
    attachments = ActivityAttachmentSerializer(many=True, read_only=True)
    deleted_attachments = serializers.ListField(child=serializers.IntegerField(), write_only=True, required=False)
    student_submission_status = serializers.SerializerMethodField()
    student_score = serializers.SerializerMethodField()
    student_feedback = serializers.SerializerMethodField()
    student_submitted_at = serializers.SerializerMethodField()
    student_graded_at = serializers.SerializerMethodField()

    submitted_students_count = serializers.SerializerMethodField()
    assigned_student_count = serializers.SerializerMethodField()
    assigned_sections = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        many=True,
        required=False,
        allow_empty=True
    )
    assigned_instructor = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.RoleChoices.INSTRUCTOR),
        required=False,
        allow_null=True
    )

    class Meta:
        model = Activity
        fields = [
            'id',
            'title',
            'description',
            'instructions',
            'activity_type',
            'due_date',
            'max_score',
            'allow_resubmission',
            'section',
            'section_name',
            'assigned_sections',
            'assigned_instructor',
            'deleted_attachments',
            'cabinet_station',
            'status',
            'created_by',
            'created_by_name',
            'created_by_last_name',
            'instructor_name',
            'attachments',
            'student_submission_status',
            'student_score',
            'student_feedback',
            'student_submitted_at',
            'student_graded_at',
            'submitted_students_count',
            'assigned_student_count',
            'created_at',
            'updated_at'
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def get_instructor_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
        return None

    def _get_uploaded_files(self):
        if not hasattr(self, 'initial_data'):
            return []

        data = self.initial_data
        if hasattr(data, 'getlist'):
            values = data.getlist('attachments')
            if values:
                return [value for value in values if value is not None]

        values = data.get('attachments', [])
        if isinstance(values, (list, tuple)):
            return [value for value in values if value is not None]
        if values is None:
            return []
        return [values]

    def _get_deleted_attachment_ids(self):
        if not hasattr(self, 'initial_data'):
            return []

        data = self.initial_data
        if hasattr(data, 'getlist'):
            values = data.getlist('deleted_attachments')
            if values:
                return [int(value) for value in values if value is not None and str(value).strip()]

        values = data.get('deleted_attachments', [])
        if isinstance(values, (list, tuple)):
            return [int(value) for value in values if value is not None and str(value).strip()]
        if values in (None, ''):
            return []
        return [int(values)]

    def _create_attachment(self, activity, uploaded_file):
        if uploaded_file is None:
            return None
        if not isinstance(uploaded_file, (UploadedFile, InMemoryUploadedFile, TemporaryUploadedFile)) and not hasattr(uploaded_file, 'read'):
            return None

        attachment = ActivityAttachment(activity=activity, file=uploaded_file)
        original_name = getattr(uploaded_file, 'name', '') or getattr(uploaded_file, 'filename', '') or ''
        attachment.original_filename = original_name.split('/')[-1]
        attachment.file_size = getattr(uploaded_file, 'size', 0) or getattr(uploaded_file, '_size', 0) or 0
        attachment.content_type = getattr(uploaded_file, 'content_type', '') or ''
        attachment.save()
        return attachment

    def _delete_attachments(self, activity, attachment_ids):
        attachments = ActivityAttachment.objects.filter(activity=activity, id__in=attachment_ids)
        for attachment in attachments:
            if attachment.file:
                attachment.file.delete(save=False)
            attachment.delete()

    def create(self, validated_data):
        assigned_sections = validated_data.pop('assigned_sections', [])
        assigned_instructor = validated_data.pop('assigned_instructor', None)
        if 'section' not in validated_data and assigned_sections:
            validated_data['section'] = assigned_sections[0]

        activity = super().create(validated_data)
        if assigned_instructor is not None:
            activity.assigned_instructor = assigned_instructor
            activity.save(update_fields=['assigned_instructor'])
        if assigned_sections:
            activity.assigned_sections.set(assigned_sections)

        for uploaded_file in self._get_uploaded_files():
            self._create_attachment(activity, uploaded_file)
        return activity

    def update(self, instance, validated_data):
        assigned_sections = validated_data.pop('assigned_sections', None)
        assigned_instructor = validated_data.pop('assigned_instructor', None)

        activity = super().update(instance, validated_data)
        if assigned_instructor is not None:
            activity.assigned_instructor = assigned_instructor
            activity.save(update_fields=['assigned_instructor'])
        if assigned_sections is not None:
            activity.assigned_sections.set(assigned_sections)

        deleted_attachment_ids = self._get_deleted_attachment_ids()
        if deleted_attachment_ids:
            self._delete_attachments(activity, deleted_attachment_ids)

        for uploaded_file in self._get_uploaded_files():
            self._create_attachment(activity, uploaded_file)
        return activity

    def get_student_submission_status(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        # Pick the latest submission for this activity + student.
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()

        # Requirement: status must be 'Not Submitted' unless a meaningful
        # Submission record exists. Ignore placeholder/empty submissions that
        # have no file and no attachments.
        if not submission:
            return 'Not Submitted'

        has_file = bool(getattr(submission, 'file', None))
        # Check related attachments if any (avoid raising when relation not set)
        try:
            has_attachments = submission.attachments.exists()
        except Exception:
            has_attachments = False

        if not has_file and not has_attachments:
            return 'Not Submitted'

        if submission.score is not None:
            return 'Graded'

        return 'Submitted'

    def get_student_score(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        return submission.score if submission else None

    def get_student_feedback(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        return submission.feedback if submission else None

    def get_student_submitted_at(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        if not submission:
            return None
        # Treat empty submissions as not submitted
        try:
            if not submission.file and not submission.attachments.exists():
                return None
        except Exception:
            pass
        return submission.submitted_at if submission else None

    def get_student_graded_at(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        if not submission:
            return None
        try:
            if not submission.file and not submission.attachments.exists():
                return None
        except Exception:
            pass
        return submission.graded_at if submission else None

    def get_submitted_students_count(self, obj):
        if hasattr(obj, 'submitted_students_count'):
            return int(obj.submitted_students_count or 0)
        return Submission.objects.filter(activity=obj).values('student').distinct().count()

    def get_assigned_student_count(self, obj):
        if hasattr(obj, 'assigned_student_count'):
            return int(obj.assigned_student_count or 0)
        if obj.section:
            return obj.section.users.count()
        return 0


class SubmissionHistorySerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.first_name', read_only=True)
    student_last_name = serializers.CharField(source='student.last_name', read_only=True)
    student_id = serializers.CharField(source='student.student_id', read_only=True)
    activity_title = serializers.CharField(source='activity.title', read_only=True)

    class Meta:
        model = Submission
        fields = [
            'id',
            'attempt',
            'activity',
            'activity_title',
            'student',
            'student_name',
            'student_last_name',
            'student_id',
            'file',
            'submitted_at',
            'score',
            'feedback',
            'graded_at',
        ]
        read_only_fields = ['id', 'attempt', 'activity', 'student', 'submitted_at', 'graded_at']


class SubmissionSerializer(serializers.ModelSerializer):
    student = serializers.PrimaryKeyRelatedField(read_only=True)
    student_name = serializers.CharField(source='student.first_name', read_only=True)
    student_last_name = serializers.CharField(source='student.last_name', read_only=True)
    student_id = serializers.CharField(source='student.student_id', read_only=True)
    student_section = serializers.CharField(source='student.section.section_name', read_only=True)
    activity_title = serializers.CharField(source='activity.title', read_only=True)
    activity_description = serializers.CharField(source='activity.description', read_only=True)
    activity_due_date = serializers.DateTimeField(source='activity.due_date', read_only=True)
    activity_max_score = serializers.FloatField(source='activity.max_score', read_only=True)
    activity_allow_resubmission = serializers.BooleanField(source='activity.allow_resubmission', read_only=True)
    graded_by_name = serializers.CharField(source='graded_by.first_name', read_only=True)
    status = serializers.SerializerMethodField()
    submission_status = serializers.SerializerMethodField()
    instructor_name = serializers.SerializerMethodField()
    due_date = serializers.SerializerMethodField()
    max_score = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    files = serializers.SerializerMethodField()
    temp_upload_ids = serializers.ListField(child=serializers.IntegerField(), write_only=True, required=False)
    removed_attachment_ids = serializers.ListField(child=serializers.IntegerField(), write_only=True, required=False)
    previous_attempts = SubmissionHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Submission
        fields = [
            'id',
            'activity',
            'activity_title',
            'activity_description',
            'activity_due_date',
            'activity_max_score',
            'activity_allow_resubmission',
            'student',
            'student_name',
            'student_last_name',
            'student_id',
            'student_section',
            'attempt',
            'file',
            'files',
            'temp_upload_ids',
            'removed_attachment_ids',
            'submitted_at',
            'remarks',
            'score',
            'feedback',
            'graded_by',
            'graded_by_name',
            'graded_at',
            'status',
            'submission_status',
            'instructor_name',
            'due_date',
            'max_score',
            'description',
            'previous_attempts',
            'updated_at'
        ]
        read_only_fields = ['submitted_at', 'updated_at', 'graded_by', 'graded_by_name', 'graded_at', 'status', 'submission_status', 'instructor_name', 'files', 'previous_attempts']

    file = serializers.FileField(required=False, allow_null=True)

    def get_status(self, obj):
        if obj.score is not None:
            return 'graded'
        if obj.activity and obj.activity.due_date and obj.submitted_at and obj.submitted_at > obj.activity.due_date:
            return 'late'
        return 'submitted'

    def get_submission_status(self, obj):
        """Get student-friendly submission status for tables"""
        if obj.score is not None:
            return 'Graded'
        if obj.activity and obj.activity.due_date and obj.submitted_at and obj.submitted_at > obj.activity.due_date:
            return 'Late'
        return 'Submitted'

    def get_instructor_name(self, obj):
        if obj.activity and obj.activity.created_by:
            return f"{obj.activity.created_by.first_name} {obj.activity.created_by.last_name}".strip()
        return None

    def get_due_date(self, obj):
        return obj.activity.due_date if obj.activity else None

    def get_max_score(self, obj):
        return obj.activity.max_score if obj.activity else None

    def get_description(self, obj):
        return obj.activity.description if obj.activity else None

    def get_files(self, obj):
        """Return file info for display, using SubmissionAttachment when available."""
        request = self.context.get('request')
        attachments = getattr(obj, 'attachments', None)
        if attachments and attachments.exists():
            data = []
            for at in attachments.all():
                try:
                    data.append({
                        'id': at.id,
                        'name': at.file.name.split('/')[-1],
                        'size': at.file.size if hasattr(at.file, 'size') else None,
                        'url': request.build_absolute_uri(at.file.url) if request else at.file.url,
                    })
                except:
                    continue
            return data

        if obj.file:
            try:
                return [{
                    'id': 1,
                    'name': obj.file.name.split('/')[-1],
                    'size': obj.file.size if hasattr(obj.file, 'size') else None,
                    'url': request.build_absolute_uri(obj.file.url) if request else obj.file.url
                }]
            except:
                return []
        return []

    def create(self, validated_data):
        temp_ids = validated_data.pop('temp_upload_ids', None)
        temp_files = []
        if temp_ids:
            temp_files = list(TemporaryUpload.objects.filter(id__in=temp_ids, user=self.context['request'].user))
            if temp_files and 'file' not in validated_data:
                validated_data['file'] = temp_files[0].file

        submission = super().create(validated_data)
        if temp_files:
            first_saved = False
            for up in temp_files:
                try:
                    att = SubmissionAttachment.objects.create(submission=submission, file=up.file)
                    if not first_saved:
                        submission.file = att.file
                        submission.save(update_fields=['file'])
                        first_saved = True
                except Exception:
                    continue
                up.delete()
        return submission

    def update(self, instance, validated_data):
        temp_ids = validated_data.pop('temp_upload_ids', None)
        removed_ids = validated_data.pop('removed_attachment_ids', None)
        temp_files = []
        if temp_ids:
            temp_files = list(TemporaryUpload.objects.filter(id__in=temp_ids, user=self.context['request'].user))

        submission = super().update(instance, validated_data)

        if removed_ids:
            for attachment in submission.attachments.filter(id__in=removed_ids):
                try:
                    if attachment.file:
                        attachment.file.delete(save=False)
                except Exception:
                    pass
                attachment.delete()

        if temp_files:
            first_saved = False
            for up in temp_files:
                try:
                    att = SubmissionAttachment.objects.create(submission=submission, file=up.file)
                    if not first_saved:
                        submission.file = att.file
                        submission.save(update_fields=['file'])
                        first_saved = True
                except Exception:
                    continue
                up.delete()

        return submission

    def get_previous_attempts(self, obj):
        previous = Submission.objects.filter(activity=obj.activity, student=obj.student).exclude(pk=obj.pk).order_by('-attempt')
        return SubmissionHistorySerializer(previous, many=True).data


class CabinetSessionSerializer(serializers.ModelSerializer):
    station_name = serializers.CharField(source='station', read_only=True)
    opened_by = serializers.SerializerMethodField()
    closed_by = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = CabinetSession
        fields = [
            'id',
            'station',
            'station_name',
            'opened_by',
            'closed_by',
            'status',
            'workflow_state',
            'opened_at',
            'closed_at',
            'participant_count',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_participant_count(self, obj):
        return obj.opened_by.count()

    def get_opened_by(self, obj):
        return [
            {'uid': user.nfc_uid, 'studentId': user.student_id, 'fullName': user.get_full_name().strip()}
            for user in obj.opened_by.all()
        ]

    def get_closed_by(self, obj):
        return [
            {'uid': user.nfc_uid, 'studentId': user.student_id, 'fullName': user.get_full_name().strip()}
            for user in obj.closed_by.all()
        ]


class AccessLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, allow_null=True)
    user_name = serializers.CharField(source='user.first_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    role = serializers.CharField(source='user.role', read_only=True, allow_null=True)
    student_id = serializers.CharField(source='user.student_id', read_only=True)
    student_name = serializers.SerializerMethodField()
    access_method = serializers.SerializerMethodField()
    access_type = serializers.SerializerMethodField()
    access_result = serializers.SerializerMethodField()
    duration_seconds = serializers.SerializerMethodField()
    section_name = serializers.CharField(source='user.section.section_name', read_only=True)
    nfc_uid = serializers.CharField(read_only=True)
    station = serializers.SerializerMethodField()
    cabinet_name = serializers.CharField(read_only=True)
    reason = serializers.CharField(read_only=True)
    cabinet_session = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = AccessLog
        fields = [
            'id',
            'user',
            'username',
            'user_name',
            'user_email',
            'role',
            'student_id',
            'student_name',
            'section_name',
            'cabinet_session',
            'access_method',
            'access_type',
            'access_result',
            'duration_seconds',
            'nfc_uid',
            'station',
            'cabinet_name',
            'action',
            'status',
            'reason',
            'access_time',
            'updated_at'
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        if not obj.user:
            return None
        return f"{obj.user.first_name} {obj.user.last_name}".strip()

    def get_access_method(self, obj):
        return 'NFC' if obj.nfc_uid else None

    def get_access_result(self, obj):
        return 'Success' if obj.status == AccessLog.AccessStatusChoices.SUCCESS else 'Failed'

    def get_station(self, obj):
        return obj.station or (obj.cabinet_session.station if obj.cabinet_session else '')

    def get_access_type(self, obj):
        if obj.status != AccessLog.AccessStatusChoices.SUCCESS:
            return 'Access Denied'
        if 'unlock' in (obj.reason or '').lower():
            return 'Cabinet Unlock'
        if obj.action == AccessLog.AccessActionChoices.OPEN:
            return 'Cabinet Opened'
        if obj.action == AccessLog.AccessActionChoices.CLOSE:
            return 'Cabinet Closed'
        if obj.action == AccessLog.AccessActionChoices.REGISTRATION:
            return 'NFC Registration'
        return 'NFC Authentication' if obj.nfc_uid else 'Access Event'

    def get_duration_seconds(self, obj):
        session = obj.cabinet_session
        if not session or not session.opened_at or not session.closed_at:
            return None
        return max(0, int((session.closed_at - session.opened_at).total_seconds()))


class CabinetEventSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_identifier = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    section_name = serializers.SerializerMethodField()
    event_type = serializers.SerializerMethodField()
    station = serializers.SerializerMethodField()
    cabinet_id = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()
    access_method = serializers.SerializerMethodField()
    nfc_uid = serializers.SerializerMethodField()
    failure_reason = serializers.SerializerMethodField()
    duration_seconds = serializers.SerializerMethodField()

    class Meta:
        model = CabinetEvent
        fields = [
            'id',
            'user',
            'user_name',
            'user_identifier',
            'role',
            'section_name',
            'event_type',
            'timestamp',
            'details',
            'station',
            'cabinet_id',
            'result',
            'access_method',
            'nfc_uid',
            'failure_reason',
            'duration_seconds',
        ]
        read_only_fields = fields

    def _details(self, obj):
        return obj.details if isinstance(obj.details, dict) else {}

    def get_user_name(self, obj):
        return obj.user.get_full_name().strip() if obj.user else None

    def get_user_identifier(self, obj):
        if not obj.user:
            return None
        return obj.user.student_id or obj.user.instructor_id or obj.user.pk

    def get_role(self, obj):
        return obj.user.role if obj.user else None

    def get_section_name(self, obj):
        return obj.user.section.section_name if obj.user and obj.user.section else None

    def get_event_type(self, obj):
        details = self._details(obj)
        raw_type = str(details.get('event_type') or obj.event_type).strip().lower().replace('-', '_').replace(' ', '_')
        action = str(details.get('action') or '').strip().lower()
        result = str(details.get('result') or '').strip().lower()
        failure_reason = str(details.get('failure_reason') or '').lower()

        if raw_type in {'session_timeout', 'timeout'}:
            return 'Session Timeout'
        if raw_type in {'unlock_failed', 'failed_unlock'} or ('unlock' in failure_reason and result not in {'success', 'granted'}):
            return 'Unlock Failed'
        if raw_type in {'access_denied', 'denied'} or result in {'failed', 'denied', 'rejected', 'duplicate', 'unregistered'}:
            return 'Access Denied'
        if raw_type in {'cabinet_closed', 'closed', 'lock'} or action == 'close':
            return 'Cabinet Closed'
        if raw_type in {'cabinet_opened', 'opened', 'open'} or action == 'open':
            return 'Cabinet Opened'
        if raw_type in {'access_granted', 'granted', 'unlock'} or result in {'success', 'granted'}:
            return 'Access Granted'
        return obj.get_event_type_display()

    def get_station(self, obj):
        return self._details(obj).get('station') or ''

    def get_cabinet_id(self, obj):
        details = self._details(obj)
        return details.get('cabinet_id') or details.get('cabinet_name') or ''

    def get_result(self, obj):
        raw_result = str(self._details(obj).get('result') or '').strip().lower()
        if raw_result in {'success', 'granted'}:
            return 'Success'
        if raw_result in {'failed', 'denied', 'rejected', 'duplicate', 'unregistered'}:
            return 'Denied' if raw_result in {'denied', 'rejected', 'duplicate', 'unregistered'} else 'Failed'
        if raw_result in {'timeout', 'timed_out'}:
            return 'Timeout'

        event_type = self.get_event_type(obj)
        if event_type in {'Access Denied', 'Unlock Failed'}:
            return 'Denied' if event_type == 'Access Denied' else 'Failed'
        if event_type == 'Session Timeout':
            return 'Timeout'
        if event_type in {'Cabinet Opened', 'Cabinet Closed', 'Access Granted'}:
            return 'Success'
        return '—'

    def get_access_method(self, obj):
        details = self._details(obj)
        return details.get('access_method') or ('NFC' if details.get('nfc_uid') else '')

    def get_nfc_uid(self, obj):
        return self._details(obj).get('nfc_uid') or ''

    def get_failure_reason(self, obj):
        if self.get_result(obj) == 'Success':
            return ''
        return self._details(obj).get('failure_reason') or ''

    def get_duration_seconds(self, obj):
        details = self._details(obj)
        if details.get('duration_seconds') is not None:
            return details['duration_seconds']
        session_id = details.get('cabinet_session_id')
        if not session_id:
            return None
        session = CabinetSession.objects.filter(pk=session_id).only('opened_at', 'closed_at').first()
        if not session or not session.opened_at or not session.closed_at:
            return None
        return max(0, int((session.closed_at - session.opened_at).total_seconds()))


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            'id',
            'title',
            'message',
            'is_read',
            'notification_type',
            'notification_key',
            'link',
            'instructor',
            'student',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'notification_key', 'instructor', 'student']


class ActivityDiscussionSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.first_name', read_only=True)
    sender_last_name = serializers.CharField(source='sender.last_name', read_only=True)
    sender_profile_image = serializers.SerializerMethodField()

    class Meta:
        model = ActivityDiscussion
        fields = ['id', 'activity', 'sender', 'sender_name', 'sender_last_name', 'sender_profile_image', 'sender_role', 'message', 'created_at', 'updated_at']
        read_only_fields = ['id', 'sender', 'sender_name', 'sender_last_name', 'sender_profile_image', 'created_at', 'updated_at']

    def get_sender_profile_image(self, obj):
        if not obj.sender or not obj.sender.profile_image:
            return None
        request = self.context.get('request')
        try:
            url = obj.sender.profile_image.url
        except Exception:
            return None
        return request.build_absolute_uri(url) if request else url


class ActivityAnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.first_name', read_only=True)
    created_by_last_name = serializers.CharField(source='created_by.last_name', read_only=True)
    created_by_profile_image = serializers.SerializerMethodField()

    class Meta:
        model = ActivityAnnouncement
        fields = [
            'id',
            'activity',
            'title',
            'message',
            'is_pinned',
            'is_update',
            'created_by',
            'created_by_name',
            'created_by_last_name',
            'created_by_profile_image',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_name', 'created_by_last_name', 'created_by_profile_image', 'created_at', 'updated_at']

    def get_created_by_profile_image(self, obj):
        if not obj.created_by or not obj.created_by.profile_image:
            return None
        request = self.context.get('request')
        try:
            url = obj.created_by.profile_image.url
        except Exception:
            return None
        return request.build_absolute_uri(url) if request else url
