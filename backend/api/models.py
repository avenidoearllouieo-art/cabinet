from django.contrib.auth.models import AbstractUser
from django.db import models


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


class User(AbstractUser):
    class RoleChoices(models.TextChoices):
        STUDENT = 'student', 'Student'
        INSTRUCTOR = 'instructor', 'Instructor'
        ADMIN = 'admin', 'Admin'

    student_id = models.CharField(max_length=50, unique=True)
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
    nfc_uid = models.CharField(max_length=100, unique=True, null=True, blank=True)
    contact_number = models.CharField(max_length=20, blank=True, default='')
    profile_image = models.ImageField(upload_to='profiles/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']

    def __str__(self):
        full_name = self.get_full_name().strip()
        display_name = full_name if full_name else self.username
        return f"{display_name} ({self.student_id})"

    class Meta:
        ordering = ['last_name', 'first_name']


class Activity(models.Model):
    id = models.AutoField(primary_key=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
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

    id = models.AutoField(primary_key=True)
    instructor = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notifications'
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    notification_type = models.CharField(max_length=50, choices=TypeChoices.choices, default=TypeChoices.SUBMISSION)
    notification_key = models.CharField(max_length=255, blank=True, default='')
    link = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Notification for {self.instructor.username}: {self.title}"

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
