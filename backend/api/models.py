from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.core.exceptions import ValidationError


class Section(models.Model):
    class StatusChoices(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        INACTIVE = 'Inactive', 'Inactive'

    section_id = models.AutoField(primary_key=True)
    section_code = models.CharField(max_length=50, blank=True, default='')
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
        ordering = ['section_name', 'section_code']


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
        # Ensure NFC UID is present for any role that may access the cabinet
        # (admin, instructor, student) and that identifiers are present for
        # role-specific requirements.
        if self.role in (self.RoleChoices.ADMIN, self.RoleChoices.INSTRUCTOR, self.RoleChoices.STUDENT):
            if not self.nfc_uid:
                raise ValidationError({'nfc_uid': 'NFC UID is required for users with this role.'})

        # Role-specific identifier requirements
        if self.role == self.RoleChoices.STUDENT and not self.student_id:
            raise ValidationError({'student_id': 'Student ID is required for student users.'})
        if self.role == self.RoleChoices.INSTRUCTOR and not self.instructor_id:
            raise ValidationError({'instructor_id': 'Instructor ID is required for instructor users.'})

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


class Activity(models.Model):
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
    status = models.CharField(max_length=30, blank=True, default='Published')
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
    file = models.FileField(upload_to='activity_attachments/')
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
    file = models.FileField(upload_to='temp_uploads/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.file.name.split('/')[-1]

    class Meta:
        ordering = ['-uploaded_at']


class SubmissionAttachment(models.Model):
    id = models.AutoField(primary_key=True)
    submission = models.ForeignKey(
        'Submission',
        on_delete=models.CASCADE,
        related_name='attachments'
    )
    file = models.FileField(upload_to='submission_attachments/')
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
    file = models.FileField(upload_to='submissions/')
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

    class Meta:
        ordering = ['-submitted_at']


class AccessLog(models.Model):
    class AccessStatusChoices(models.TextChoices):
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'

    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='access_logs'
    )
    access_time = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=AccessStatusChoices.choices)
    rfid_tag = models.CharField(max_length=100, blank=True, default='')
    cabinet_name = models.CharField(max_length=100, blank=True, default='')
    reason = models.TextField(blank=True, default='')
    image = models.FileField(upload_to='access_logs/', null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        if self.user:
            return f"{self.user.first_name} - {self.status} at {self.access_time}"
        return f"Unknown user - {self.status} at {self.access_time}"

    class Meta:
        ordering = ['-access_time']


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
