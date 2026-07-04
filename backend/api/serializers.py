from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import Section, User, Activity, ActivityAttachment, Submission, AccessLog, CabinetEvent, Notification


class SectionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='section_id', read_only=True)

    class Meta:
        model = Section
        fields = [
            'id',
            'section_id',
            'section_code',
            'section_name',
            'program',
            'year_level',
            'academic_year',
            'adviser_instructor',
            'student_count',
            'status',
        ]


class InstructorSectionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='section_id', read_only=True)

    class Meta:
        model = Section
        fields = [
            'id',
            'section_id',
            'section_name',
            'year_level',
            'academic_year',
            'student_count',
            'status',
        ]


class UserSerializer(serializers.ModelSerializer):
    section_name = serializers.CharField(source='section.section_name', read_only=True)
    section_year_level = serializers.CharField(source='section.year_level', read_only=True)
    section_academic_year = serializers.CharField(source='section.academic_year', read_only=True)
    attendance_present_count = serializers.SerializerMethodField()
    attendance_absent_count = serializers.SerializerMethodField()
    attendance_percentage = serializers.SerializerMethodField()
    profile_image_url = serializers.SerializerMethodField()
    assigned_sections = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
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
            'section_year_level',
            'section_academic_year',
            'nfc_uid',
            'attendance_present_count',
            'attendance_absent_count',
            'attendance_percentage',
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

    def get_assigned_sections(self, obj):
        if obj.role != User.RoleChoices.INSTRUCTOR:
            return []
        sections = obj.instructor_sections.all()
        return [
            {
                'section_id': section.section_id,
                'section_name': section.section_name,
                'year_level': section.year_level,
                'academic_year': section.academic_year,
            }
            for section in sections
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'password': {'write_only': True, 'required': False}
        }

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = super().create(validated_data)
        if password:
            user.set_password(password)
            user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save()
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


class ActivityAttachmentSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ActivityAttachment
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
    student_submission_status = serializers.SerializerMethodField()
    student_score = serializers.SerializerMethodField()
    student_feedback = serializers.SerializerMethodField()
    student_submitted_at = serializers.SerializerMethodField()
    student_graded_at = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            'id',
            'title',
            'description',
            'instructions',
            'due_date',
            'max_score',
            'allow_resubmission',
            'section',
            'section_name',
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
            'created_at',
            'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_instructor_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
        return None

    def get_student_submission_status(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None

        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        now = timezone.now()
        if not submission:
            if obj.due_date and obj.due_date < now:
                return 'Late Submission'
            return 'Not Submitted'

        if submission.score is not None:
            return 'Graded'
        if obj.due_date and submission.submitted_at and submission.submitted_at > obj.due_date:
            return 'Late Submission'
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
        return submission.submitted_at if submission else None

    def get_student_graded_at(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or user.role != User.RoleChoices.STUDENT:
            return None
        submission = Submission.objects.filter(activity=obj, student=user).order_by('-submitted_at').first()
        return submission.graded_at if submission else None


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
        """Return file info for display"""
        if obj.file:
            try:
                return [{
                    'id': 1,
                    'name': obj.file.name.split('/')[-1],
                    'size': obj.file.size if hasattr(obj.file, 'size') else None,
                    'url': self.context.get('request').build_absolute_uri(obj.file.url) if self.context.get('request') else obj.file.url
                }]
            except:
                return []
        return []

    def get_previous_attempts(self, obj):
        previous = Submission.objects.filter(activity=obj.activity, student=obj.student).exclude(pk=obj.pk).order_by('-attempt')
        return SubmissionHistorySerializer(previous, many=True).data


class AccessLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.first_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    student_id = serializers.CharField(source='user.student_id', read_only=True)
    student_name = serializers.SerializerMethodField()
    section_name = serializers.CharField(source='user.section.section_name', read_only=True)
    rfid_tag = serializers.CharField(read_only=True)
    cabinet_name = serializers.CharField(read_only=True)
    reason = serializers.CharField(read_only=True)

    class Meta:
        model = AccessLog
        fields = [
            'id',
            'user',
            'user_name',
            'user_email',
            'student_id',
            'student_name',
            'section_name',
            'rfid_tag',
            'cabinet_name',
            'access_time',
            'status',
            'reason',
            'image',
            'updated_at'
        ]
        read_only_fields = ['access_time', 'updated_at']

    def get_student_name(self, obj):
        if not obj.user:
            return None
        return f"{obj.user.first_name} {obj.user.last_name}".strip()


class CabinetEventSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.first_name', read_only=True)

    class Meta:
        model = CabinetEvent
        fields = [
            'id',
            'user',
            'user_name',
            'event_type',
            'timestamp',
            'details'
        ]
        read_only_fields = ['timestamp']


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
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'notification_key']
