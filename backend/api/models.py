from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
import uuid
import os
import re
from django.core.exceptions import ValidationError
from django.utils import timezone
import secrets
import hashlib
from datetime import timedelta


def _upload_extension(filename):
    raw_name = str(filename or '').replace('\\', '/')
    extension = os.path.splitext(raw_name.rsplit('/', 1)[-1])[1].lower()
    return extension if re.fullmatch(r'\.[a-z0-9]{1,10}', extension) else ''


def activity_attachment_upload_to(instance, filename):
    return f'activities/attachments/{uuid.uuid4().hex}{_upload_extension(filename)}'


def activity_discussion_upload_to(instance, filename):
    return f'activities/discussions/{uuid.uuid4().hex}{_upload_extension(filename)}'


def submission_upload_to(instance, filename):
    extension = _upload_extension(filename)
    category = 'videos' if extension in {'.mp4', '.mov', '.webm'} else 'files'
    owner_id = getattr(instance, 'user_id', None) or getattr(instance, 'student_id', None)
    if owner_id is None and getattr(instance, 'submission_id', None):
        owner_id = instance.submission.student_id
    return f'submissions/{category}/{owner_id or "unassigned"}/{uuid.uuid4().hex}{extension}'


class Section(models.Model):
    class StatusChoices(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        INACTIVE = 'Inactive', 'Inactive'

    section_id = models.AutoField(primary_key=True)
    subject_code = models.CharField(max_length=50, blank=True, default='', verbose_name='Subject Code')
    section_name = models.CharField(max_length=100)
    instructor = models.ForeignKey(
        'User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='instructor_sections'
    )
    program = models.CharField(max_length=50, blank=True, default='')
    year_level = models.CharField(max_length=50, blank=True, default='')
    academic_year = models.CharField(max_length=20, blank=True, default='')
    adviser_instructor = models.CharField(max_length=100, blank=True, default='')
    student_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=StatusChoices.choices, default=StatusChoices.ACTIVE)

    def __str__(self):
        return self.section_name

    class Meta:
        ordering = ['section_name', 'subject_code']


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, username, email, password, **extra_fields):
        if not email:
            raise ValueError('The Email field is required')
        email = self.normalize_email(email)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', User.RoleChoices.STUDENT)
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(username, email, password, **extra_fields)

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', User.RoleChoices.ADMIN)
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)

        if extra_fields.get('role') != User.RoleChoices.ADMIN:
            raise ValueError('Superuser must have role=ADMIN.')
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self._create_user(username, email, password, **extra_fields)


class User(AbstractUser):
    class RoleChoices(models.TextChoices):
        STUDENT = 'student', 'Student'
        INSTRUCTOR = 'instructor', 'Instructor'
        ADMIN = 'admin', 'Admin'

    # Allow both student and instructor identifiers. Make them optional
    # at the DB level to ease migrations; enforce role-specific
    # requirements in `clean()` below.
    student_id = models.CharField(max_length=50, unique=True, null=True, blank=True)
    instructor_id = models.CharField(max_length=50, unique=True, null=True, blank=True)
    administrator_id = models.CharField(max_length=50, unique=True, null=True, blank=True)
    email = models.EmailField(unique=True)
    role = models.CharField(
        max_length=20,
        choices=RoleChoices.choices,
        default=RoleChoices.STUDENT
    )
    section = models.ForeignKey(
        Section,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users'
    )
    # NFC UID must be globally unique. Keep DB nullable for migration
    # safety but enforce presence for roles that access the cabinet.
    nfc_uid = models.CharField(max_length=100, unique=True, null=True, blank=True)
    registration_pin_hash = models.CharField(max_length=128, blank=True, default='')
    registration_pin_expires_at = models.DateTimeField(null=True, blank=True)
    registration_pin_attempts = models.PositiveSmallIntegerField(default=0)
    registration_pin_issued_at = models.DateTimeField(null=True, blank=True)
    registration_pin_issued_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='registration_pins_issued',
    )
    # Many-to-many assigned sections for instructors. Keep existing
    # Section.instructor FK for backward compatibility.
    assigned_sections = models.ManyToManyField(Section, related_name='assigned_instructors', blank=True)
    contact_number = models.CharField(max_length=20, blank=True, default='')
    profile_image = models.ImageField(upload_to='profiles/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']

    def __str__(self):
        full_name = self.get_full_name().strip()
        display_name = full_name if full_name else self.username
        identifier = self.student_id or self.instructor_id or ''
        if identifier:
            return f"{display_name} ({identifier})"
        return display_name

    def clean(self):
        # Students may await NFC enrollment; staff cabinet roles require a UID.
        if self.role == self.RoleChoices.INSTRUCTOR and not getattr(self, '_allow_unassigned_nfc_for_import', False):
            if not self.nfc_uid:
                raise ValidationError({'nfc_uid': 'NFC UID is required for users with this role.'})

        # Role-specific identifier requirements
        if self.role == self.RoleChoices.STUDENT and not self.student_id:
            raise ValidationError({'student_id': 'Student ID is required for student users.'})
        if self.role == self.RoleChoices.INSTRUCTOR and not self.instructor_id:
            raise ValidationError({'instructor_id': 'Instructor ID is required for instructor users.'})
        if self.role == self.RoleChoices.ADMIN and not self.administrator_id:
            raise ValidationError({'administrator_id': 'Administrator ID is required for administrator users.'})

        # NFC uniqueness is enforced at DB level (unique=True), but validate
        # at model-clean time to provide friendlier errors before DB save.
        if self.nfc_uid:
            qs = User.objects.filter(nfc_uid=self.nfc_uid)
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError({'nfc_uid': 'This NFC UID is already assigned to another user.'})

    class Meta:
        ordering = ['last_name', 'first_name']
        permissions = [
            ('provision_administrator', 'Can provision administrator accounts'),
        ]


class PrivilegedUserAuditEvent(models.Model):
    class EventType(models.TextChoices):
        ADMIN_CREATED = 'administrator_created', 'Administrator created'
        ROLE_CHANGED = 'role_changed', 'User role changed'
        ADMIN_ACTIVATED = 'administrator_activated', 'Administrator activated'
        ADMIN_DEACTIVATED = 'administrator_deactivated', 'Administrator deactivated'
        REGISTRATION_PIN_ISSUED = 'registration_pin_issued', 'Registration PIN issued'

    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='privileged_actions_performed',
    )
    target_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='privileged_actions_received',
    )
    event_type = models.CharField(max_length=40, choices=EventType.choices)
    previous_role = models.CharField(max_length=20, blank=True, default='')
    new_role = models.CharField(max_length=20, blank=True, default='')
    enrollment = models.ForeignKey(
        'NFCEnrollmentSession',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='privileged_audit_events',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError('Privileged user audit events are append-only.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Privileged user audit events are append-only.')

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['target_user', 'created_at'])]


class Activity(models.Model):
    class StatusChoices(models.TextChoices):
        DRAFT = 'Draft', 'Draft'
        PUBLISHED = 'Published', 'Published'
        CLOSED = 'Closed', 'Closed'
        ARCHIVED = 'Archived', 'Archived'

    id = models.AutoField(primary_key=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    activity_type = models.CharField(max_length=50, blank=True, default='Assignment')
    due_date = models.DateTimeField(null=True, blank=True)
    max_score = models.FloatField(default=100)
    allow_resubmission = models.BooleanField(default=False)
    section = models.ForeignKey(
        Section,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='activities'
    )
    assigned_sections = models.ManyToManyField(Section, related_name='assigned_activities', blank=True)
    assigned_instructor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_activities'
    )
    cabinet_station = models.CharField(max_length=100, blank=True, default='')
    status = models.CharField(max_length=30, choices=StatusChoices.choices, blank=True, default=StatusChoices.DRAFT)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_activities'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    

    def __str__(self):
        return self.title

    class Meta:
        ordering = ['-created_at']


class ActivityAttachment(models.Model):
    id = models.AutoField(primary_key=True)
    activity = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        related_name='attachments'
    )
    file = models.FileField(upload_to=activity_attachment_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.PositiveIntegerField(default=0)
    content_type = models.CharField(max_length=255, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_filename or self.file.name.split('/')[-1]

    class Meta:
        ordering = ['-uploaded_at']


class ActivityDiscussion(models.Model):
    id = models.AutoField(primary_key=True)
    activity = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        related_name='discussions'
    )
    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='activity_messages'
    )
    sender_role = models.CharField(max_length=20, blank=True)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Msg {self.id} on {self.activity_id} by {self.sender_id}"


class ActivityDiscussionAttachment(models.Model):
    id = models.AutoField(primary_key=True)
    discussion = models.ForeignKey(
        ActivityDiscussion,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    file = models.FileField(upload_to=activity_discussion_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.PositiveIntegerField(default=0)
    content_type = models.CharField(max_length=255, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_filename or self.file.name.split('/')[-1]

    class Meta:
        ordering = ['uploaded_at']


class ActivityAnnouncement(models.Model):
    id = models.AutoField(primary_key=True)
    activity = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        related_name='announcements'
    )
    title = models.CharField(max_length=255, blank=True, default='')
    message = models.TextField()
    is_pinned = models.BooleanField(default=False)
    is_update = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='activity_announcements'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_pinned', '-created_at']

    def __str__(self):
        return f"Announcement {self.id} on {self.activity_id} by {self.created_by_id}"


class TemporaryUpload(models.Model):
    """Temporary upload storage for student file drafts.

    Students can upload a file which is stored temporarily and referenced
    by a `temp_upload_id` when creating a final `Submission`.
    """
    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='temporary_uploads'
    )
    activity = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='temporary_uploads'
    )
    file = models.FileField(upload_to=submission_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.BigIntegerField(default=0)
    content_type = models.CharField(max_length=255, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.file.name.split('/')[-1]

    class Meta:
        ordering = ['-uploaded_at']


class MultipartUploadSession(models.Model):
    class StatusChoices(models.TextChoices):
        INITIATED = 'initiated', 'Initiated'
        COMPLETED = 'completed', 'Completed'
        ABORTED = 'aborted', 'Aborted'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='multipart_upload_sessions')
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='multipart_upload_sessions')
    temporary_upload = models.OneToOneField(
        TemporaryUpload,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='multipart_session',
    )
    object_key = models.CharField(max_length=512, unique=True)
    upload_id = models.CharField(max_length=1024)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    file_size = models.BigIntegerField()
    part_size = models.PositiveIntegerField()
    total_parts = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=StatusChoices.choices, default=StatusChoices.INITIATED)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'expires_at']),
            models.Index(fields=['user', 'activity', 'status']),
        ]


class SubmissionAttachment(models.Model):
    id = models.AutoField(primary_key=True)
    submission = models.ForeignKey(
        'Submission',
        on_delete=models.CASCADE,
        related_name='attachments'
    )
    file = models.FileField(upload_to=submission_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.BigIntegerField(default=0)
    content_type = models.CharField(max_length=255, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.file.name.split('/')[-1]

    class Meta:
        ordering = ['-uploaded_at']


class Submission(models.Model):
    id = models.AutoField(primary_key=True)
    activity = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        related_name='submissions'
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='submissions'
    )
    attempt = models.PositiveIntegerField(default=1)
    file = models.FileField(upload_to=submission_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.BigIntegerField(default=0)
    content_type = models.CharField(max_length=255, blank=True, default='')
    submitted_at = models.DateTimeField(auto_now_add=True)
    remarks = models.TextField(blank=True)
    score = models.FloatField(null=True, blank=True)
    feedback = models.TextField(blank=True)
    graded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='graded_submissions'
    )
    graded_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.student.first_name} - {self.activity.title}"

    @property
    def status(self):
        if self.score is not None:
            return 'Graded'
        if self.activity_id and self.activity.due_date and self.submitted_at > self.activity.due_date:
            return 'Late'
        return 'Submitted'

    class Meta:
        ordering = ['-submitted_at']


class CabinetSessionQuerySet(models.QuerySet):
    identity_fields = frozenset({'session_uuid', 'motor_dispatch_eligible'})

    def update(self, **kwargs):
        if self.identity_fields.intersection(kwargs):
            raise ValidationError('Cabinet session motor identity is immutable.')
        return super().update(**kwargs)

    def bulk_update(self, objs, fields, batch_size=None):
        if self.identity_fields.intersection(fields):
            raise ValidationError('Cabinet session motor identity is immutable.')
        return super().bulk_update(objs, fields, batch_size=batch_size)

    def bulk_create(self, objs, batch_size=None, ignore_conflicts=False, update_conflicts=False, update_fields=None, unique_fields=None):
        if self.identity_fields.intersection(update_fields or ()):
            raise ValidationError('Cabinet session motor identity is immutable.')
        return super().bulk_create(objs, batch_size=batch_size, ignore_conflicts=ignore_conflicts,
                                   update_conflicts=update_conflicts, update_fields=update_fields, unique_fields=unique_fields)


class CabinetSession(models.Model):
    objects = CabinetSessionQuerySet.as_manager()
    class StatusChoices(models.TextChoices):
        OPEN = 'open', 'Open'
        CLOSED = 'closed', 'Closed'

    class WorkflowStateChoices(models.TextChoices):
        IDLE = 'idle', 'Idle'
        OPENING = 'opening', 'Opening'
        CLOSING = 'closing', 'Closing'

    id = models.AutoField(primary_key=True)
    session_uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    # Backfilled sessions are permanently inhibited. Only newly created sessions
    # receive True; assigning a UUID must never authorize historical movement.
    motor_dispatch_eligible = models.BooleanField(default=True, editable=False)
    station = models.CharField(max_length=100, blank=True, default='')
    status = models.CharField(max_length=20, choices=StatusChoices.choices, default=StatusChoices.OPEN)
    workflow_state = models.CharField(max_length=20, choices=WorkflowStateChoices.choices, default=WorkflowStateChoices.IDLE)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    opened_by = models.ManyToManyField(User, blank=True, related_name='opened_cabinet_sessions')
    closed_by = models.ManyToManyField(User, blank=True, related_name='closed_cabinet_sessions')
    participant_count = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        status_label = self.status or self.StatusChoices.OPEN
        return f"Cabinet session {self.station or 'unknown'} ({status_label})"

    def save(self, *args, **kwargs):
        if self.pk is not None:
            using = kwargs.get('using') or self._state.db or 'default'
            previous = type(self).objects.using(using).filter(pk=self.pk).values(
                'session_uuid', 'motor_dispatch_eligible',
            ).first()
            if previous and (
                str(previous['session_uuid']) != str(self.session_uuid)
                or previous['motor_dispatch_eligible'] != self.motor_dispatch_eligible
            ):
                raise ValidationError('Cabinet session motor identity is immutable.')
        return super().save(*args, **kwargs)

    class Meta:
        ordering = ['-opened_at']
        constraints = [
            models.UniqueConstraint(
                fields=['station'],
                condition=models.Q(status='open') & ~models.Q(station=''),
                name='uniq_open_cabinetsession_station',
            ),
        ]


class AccessLog(models.Model):
    class AccessStatusChoices(models.TextChoices):
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'
        UNREGISTERED = 'unregistered', 'Unregistered'
        DUPLICATE = 'duplicate', 'Duplicate'
        REJECTED = 'rejected', 'Rejected'

    class AccessActionChoices(models.TextChoices):
        SCAN = 'scan', 'Scan'
        OPEN = 'open', 'Open'
        CLOSE = 'close', 'Close'
        REGISTRATION = 'registration', 'Registration'

    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='access_logs'
    )
    cabinet_session = models.ForeignKey(
        CabinetSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='access_logs'
    )
    access_time = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=AccessStatusChoices.choices, default=AccessStatusChoices.SUCCESS)
    action = models.CharField(max_length=20, choices=AccessActionChoices.choices, default=AccessActionChoices.SCAN)
    nfc_uid = models.CharField(max_length=100, blank=True, default='')
    station = models.CharField(max_length=100, blank=True, default='')
    cabinet_name = models.CharField(max_length=100, blank=True, default='')
    reason = models.TextField(blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    @staticmethod
    def normalize_nfc_uid(value):
        return ''.join(str(value or '').split()).upper()

    def save(self, *args, **kwargs):
        self.nfc_uid = self.normalize_nfc_uid(self.nfc_uid)
        super().save(*args, **kwargs)

    def __str__(self):
        if self.user:
            return f"{self.user.first_name} - {self.status} at {self.access_time}"
        return f"Unknown user - {self.status} at {self.access_time}"

    class Meta:
        ordering = ['-access_time']
        indexes = [
            models.Index(fields=['nfc_uid', 'status']),
            models.Index(fields=['cabinet_session', 'status']),
            models.Index(fields=['station', 'access_time']),
        ]


def access_log_photo_upload_to(instance, filename):
    return f'access-log-photos/{uuid.uuid4().hex}.jpg'


class AccessLogPhoto(models.Model):
    class CaptureStatusChoices(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'

    access_log = models.OneToOneField(
        AccessLog,
        on_delete=models.CASCADE,
        related_name='photo',
    )
    image = models.ImageField(upload_to=access_log_photo_upload_to, blank=True)
    capture_status = models.CharField(
        max_length=10,
        choices=CaptureStatusChoices.choices,
        default=CaptureStatusChoices.PENDING,
    )
    captured_at = models.DateTimeField(null=True, blank=True)
    diagnostic_error = models.TextField(blank=True, default='')

    def __str__(self):
        return f'Photo for access log {self.access_log_id} ({self.capture_status})'


@receiver(post_delete, sender=AccessLogPhoto)
def delete_access_log_photo_file(sender, instance, **kwargs):
    if instance.image:
        instance.image.delete(save=False)


class Notification(models.Model):
    class TypeChoices(models.TextChoices):
        SUBMISSION = 'submission', 'Submission'
        RESUBMISSION = 'resubmission', 'Resubmission'
        DEADLINE = 'deadline', 'Deadline'
        ACCESS_LOG = 'access_log', 'Access Log'
        ACTIVITY = 'activity', 'Activity'
        ANNOUNCEMENT = 'announcement', 'Announcement'
        GRADE = 'grade', 'Grade'
        FEEDBACK = 'feedback', 'Feedback'

    id = models.AutoField(primary_key=True)
    instructor = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications'
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='student_notifications'
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    notification_type = models.CharField(max_length=50, choices=TypeChoices.choices, default=TypeChoices.SUBMISSION)
    notification_key = models.CharField(max_length=255, blank=True, default='')
    link = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        recipient = self.instructor or self.student
        return f"Notification for {recipient.username if recipient else 'unknown user'}: {self.title}"

    class Meta:
        ordering = ['-created_at']
        unique_together = [['instructor', 'notification_key']]


class PasswordResetRequest(models.Model):
    class StatusChoices(models.TextChoices):
        PENDING = 'pending', 'Pending'
        VERIFIED = 'verified', 'Verified'
        USED = 'used', 'Used'
        EXPIRED = 'expired', 'Expired'
        CANCELLED = 'cancelled', 'Cancelled'

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='password_reset_requests',
        null=True,
        blank=True,
    )
    request_id = models.CharField(max_length=64, unique=True, blank=True, default='')
    student_id_snapshot = models.CharField(max_length=50, blank=True, default='')
    email_snapshot = models.EmailField(blank=True, default='')
    reset_token_hash = models.CharField(max_length=255, blank=True, default='')
    reset_authorization_hash = models.CharField(max_length=255, blank=True, default='')
    reset_authorization_nonce = models.CharField(max_length=64, blank=True, default='')
    reset_authorization_expires_at = models.DateTimeField(null=True, blank=True)
    reset_authorization_used_at = models.DateTimeField(null=True, blank=True)
    cabinet_handoff_claimed_at = models.DateTimeField(null=True, blank=True)
    cabinet_handoff_expires_at = models.DateTimeField(null=True, blank=True)
    cabinet_handoff_used_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=StatusChoices.choices, default=StatusChoices.PENDING)
    requested_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=timezone.now)
    verified_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    nfc_uid_verified = models.BooleanField(default=False)
    reason = models.TextField(blank=True, default='')

    def save(self, *args, **kwargs):
        if not self.request_id:
            self.request_id = secrets.token_urlsafe(18)[:32]
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(minutes=15)
        if self.user_id and not self.student_id_snapshot:
            self.student_id_snapshot = self.user.student_id or ''
        if self.user_id and not self.email_snapshot:
            self.email_snapshot = self.user.email or ''
        super().save(*args, **kwargs)

    def set_reset_token(self, token):
        self.reset_token_hash = make_password(token)

    def verify_reset_token(self, token):
        if not self.reset_token_hash:
            return False
        return check_password(token, self.reset_token_hash)

    def set_reset_authorization(self, authorization):
        self.reset_authorization_hash = make_password(authorization)

    def verify_reset_authorization(self, authorization):
        if not self.reset_authorization_hash:
            return False
        if not self.reset_authorization_expires_at:
            return False
        if self.reset_authorization_used_at:
            return False
        if timezone.now() > self.reset_authorization_expires_at:
            return False
        return check_password(authorization, self.reset_authorization_hash)

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"Password reset ({self.status})"

    class Meta:
        ordering = ['-requested_at']
        indexes = [
            models.Index(fields=['status', 'expires_at'], name='api_prr_status_exp_idx'),
            models.Index(fields=['cabinet_handoff_claimed_at'], name='api_prr_handoff_idx'),
        ]


class PasswordRecoveryAuditEvent(models.Model):
    class EventType(models.TextChoices):
        REQUEST_CREATED = 'request_created', 'Request created'
        REQUEST_CANCELLED = 'request_cancelled', 'Request cancelled'
        REQUEST_EXPIRED = 'request_expired', 'Request expired'
        CABINET_CLAIMED = 'cabinet_claimed', 'Cabinet claimed'
        NFC_SCAN_RECEIVED = 'nfc_scan_received', 'NFC scan received'
        NFC_VERIFIED = 'nfc_verified', 'NFC verified'
        NFC_REJECTED = 'nfc_rejected', 'NFC rejected'
        AUTHORIZATION_ISSUE = 'authorization_issued', 'Authorization issued'
        RESET_COMPLETED = 'reset_completed', 'Password reset completed'
        RESET_REJECTED = 'reset_rejected', 'Reset rejected'

    class Outcome(models.TextChoices):
        SUCCESS = 'success', 'Success'
        FAILURE = 'failure', 'Failure'
        INFO = 'info', 'Info'

    class ActorType(models.TextChoices):
        PORTAL = 'portal', 'Portal'
        CABINET = 'cabinet', 'Cabinet'
        PI = 'pi', 'Pi service'
        DJANGO = 'django', 'Django'
        ADMIN = 'admin', 'Administrator'

    recovery_request = models.ForeignKey(
        PasswordResetRequest,
        on_delete=models.CASCADE,
        related_name='audit_events',
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='password_recovery_audit_events',
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    outcome = models.CharField(max_length=16, choices=Outcome.choices)
    reason_code = models.CharField(max_length=64, blank=True, default='')
    actor_type = models.CharField(max_length=16, choices=ActorType.choices)
    correlation_id = models.CharField(max_length=64, blank=True, default='')
    timestamp = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError('Password recovery audit events are append-only.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Password recovery audit events are append-only.')

    def __str__(self):
        return f'{self.recovery_request_id}: {self.event_type}'

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['event_type', 'timestamp'], name='api_prae_type_ts_idx'),
            models.Index(fields=['recovery_request', 'timestamp'], name='api_prae_req_ts_idx'),
            models.Index(fields=['timestamp'], name='api_prae_ts_idx'),
        ]


class CabinetLocation(models.Model):
    cabinet_name = models.CharField(max_length=100, unique=True)
    institution_name = models.CharField(max_length=200, default='University of Science and Technology of Southern Philippines')
    college_name = models.CharField(max_length=200, default='College of Information Technology and Computing')
    building_name = models.CharField(max_length=100, default='CITC Building')
    location_description = models.CharField(max_length=200, default='Hallway near the CITC Office')
    purpose = models.CharField(max_length=200, default='Laboratory Equipment Storage and Monitoring')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cabinet_name

    class Meta:
        ordering = ['cabinet_name']


class NFCEnrollmentSession(models.Model):
    class StatusChoices(models.TextChoices):
        PENDING = 'pending', 'Pending'
        COMPLETED = 'completed', 'Completed'
        EXPIRED = 'expired', 'Expired'
        CANCELLED = 'cancelled', 'Cancelled'

    nfc_uid = models.CharField(max_length=100)
    device_id = models.CharField(max_length=100, blank=True, default='')
    station = models.CharField(max_length=100, blank=True, default='')
    cabinet_name = models.CharField(max_length=100, blank=True, default='')
    token_digest = models.CharField(max_length=64, unique=True)
    token_hash = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=StatusChoices.choices, default=StatusChoices.PENDING)
    expires_at = models.DateTimeField()
    completion_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='nfc_enrollment_sessions',
    )
    registration_target_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pending_nfc_identity_checks',
    )
    def set_token(self, token):
        self.token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        self.token_hash = make_password(token)

    def verify_token(self, token):
        return bool(self.token_hash) and check_password(token, self.token_hash)

    @property
    def is_expired(self):
        deadline = self.completion_expires_at or self.expires_at
        return timezone.now() >= deadline

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['nfc_uid', 'status']),
            models.Index(fields=['expires_at']),
        ]


class CabinetEvent(models.Model):
    class EventTypeChoices(models.TextChoices):
        UNLOCK = 'unlock', 'Unlock'
        LOCK = 'lock', 'Lock'
        ALERT = 'alert', 'Alert'
        MAINTENANCE = 'maintenance', 'Maintenance'
        CABINET_OPENED = 'cabinet_opened', 'Cabinet Opened'

    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cabinet_events'
    )
    event_type = models.CharField(max_length=30, choices=EventTypeChoices.choices)
    timestamp = models.DateTimeField(auto_now_add=True)
    details = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.event_type} - {self.timestamp}"

    class Meta:
        ordering = ['-timestamp']
 


class StudentProfileManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(role=User.RoleChoices.STUDENT)


class InstructorProfileManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(role=User.RoleChoices.INSTRUCTOR)


class AdminProfileManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(role=User.RoleChoices.ADMIN)


# Proxy models to allow separate admin pages for each role while keeping
# a single underlying User model for authentication.
class StudentProfile(User):
    objects = StudentProfileManager()

    class Meta:
        proxy = True
        verbose_name = 'Student Profile'
        verbose_name_plural = 'Students'


class InstructorProfile(User):
    objects = InstructorProfileManager()

    class Meta:
        proxy = True
        verbose_name = 'Instructor Profile'
        verbose_name_plural = 'Instructors'


class AdminProfile(User):
    objects = AdminProfileManager()

    class Meta:
        proxy = True
        verbose_name = 'Administrator Profile'
        verbose_name_plural = 'Administrators'
