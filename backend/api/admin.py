from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserCreationForm, UserChangeForm
from .models import Section, User, Activity, Submission, AccessLog, CabinetEvent


class CustomUserCreationForm(UserCreationForm):
    """
    Custom user creation form that includes additional fields for the User model.
    Handles password hashing securely for new users.
    """

    class Meta:
        model = User
        fields = ('username', 'email', 'student_id', 'first_name', 'last_name', 'role', 'section', 'nfc_uid', 'is_active', 'is_staff', 'is_superuser')


class CustomUserChangeForm(UserChangeForm):
    """
    Custom user change form that includes additional fields for the User model.
    Allows existing users to change passwords safely.
    """

    class Meta:
        model = User
        fields = ('username', 'email', 'student_id', 'first_name', 'last_name', 'role', 'section', 'nfc_uid', 'is_active', 'is_staff', 'is_superuser')


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ('section_id', 'section_code', 'section_name', 'program', 'year_level', 'status')
    list_filter = ('program', 'year_level', 'status')
    search_fields = ('section_code', 'section_name', 'program', 'year_level', 'adviser_instructor')
    ordering = ('section_name',)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = CustomUserChangeForm
    add_form = CustomUserCreationForm

    list_display = (
        'id',
        'student_id',
        'username',
        'first_name',
        'last_name',
        'email',
        'role',
        'section',
        'is_active',
    )
    list_filter = ('role', 'section', 'is_active')
    search_fields = ('student_id', 'username', 'first_name', 'last_name', 'email')
    ordering = ('id',)
    readonly_fields = ('created_at', 'updated_at', 'last_login', 'date_joined')

    fieldsets = (
        ('Authentication', {'fields': ('username', 'password')}),
        ('Personal Info', {'fields': ('first_name', 'last_name', 'email')}),
        ('Custom Fields', {'fields': ('student_id', 'role', 'section', 'nfc_uid')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Timestamps', {'fields': ('date_joined', 'last_login', 'created_at', 'updated_at'), 'classes': ('collapse',)}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2'),
        }),
        ('Personal Info', {
            'classes': ('wide',),
            'fields': ('first_name', 'last_name'),
        }),
        ('Custom Fields', {
            'classes': ('wide',),
            'fields': ('student_id', 'role', 'section', 'nfc_uid'),
        }),
        ('Permissions', {
            'classes': ('wide',),
            'fields': ('is_active', 'is_staff', 'is_superuser'),
        }),
    )


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ('title', 'created_by', 'due_date', 'created_at')
    list_filter = ('created_by', 'due_date')
    search_fields = ('title', 'description')
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'updated_at')
    date_hierarchy = 'created_at'


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    list_display = ('activity', 'student', 'submitted_at', 'updated_at')
    list_filter = ('activity', 'student')
    search_fields = ('student__first_name', 'student__last_name', 'activity__title')
    ordering = ('-submitted_at',)
    readonly_fields = ('submitted_at', 'updated_at')
    date_hierarchy = 'submitted_at'


@admin.register(AccessLog)
class AccessLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'status', 'access_time', 'updated_at')
    list_filter = ('status', 'user__section')
    search_fields = ('user__first_name', 'user__last_name', 'user__student_id')
    ordering = ('-access_time',)
    readonly_fields = ('access_time', 'updated_at')
    date_hierarchy = 'access_time'


@admin.register(CabinetEvent)
class CabinetEventAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'user', 'timestamp')
    list_filter = ('event_type', 'user')
    search_fields = ('user__first_name', 'user__last_name', 'event_type')
    ordering = ('-timestamp',)
    readonly_fields = ('timestamp',)
    date_hierarchy = 'timestamp'
