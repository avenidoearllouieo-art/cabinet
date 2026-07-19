from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django import forms

from .models import (
    Section,
    User,
    StudentProfile,
    InstructorProfile,
    AdminProfile,
    Activity,
    Submission,
    AccessLog,
    CabinetEvent,
)


class CustomUserChangeForm(UserChangeForm):
    class Meta:
        model = User
        fields = (
            'username', 'email', 'student_id', 'instructor_id', 'first_name', 'last_name',
            'section', 'assigned_sections', 'nfc_uid', 'profile_image',
            'is_active', 'is_staff', 'is_superuser', 'role'
        )


@admin.register(User)
class CustomUserAdmin(BaseUserAdmin):
    form = CustomUserChangeForm
    add_form = UserCreationForm
    autocomplete_fields = ('section', 'assigned_sections')
    list_display = ('username', 'email', 'first_name', 'last_name', 'role', 'is_staff', 'is_superuser')
    list_filter = ('role', 'is_staff', 'is_superuser', 'is_active')
    search_fields = ('username', 'email', 'student_id', 'instructor_id', 'first_name', 'last_name')
    ordering = ('username',)
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'email', 'section', 'student_id', 'instructor_id', 'nfc_uid', 'assigned_sections', 'profile_image')}),
        ('Permissions', {'fields': ('role', 'is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'role', 'is_active', 'is_staff', 'is_superuser'),
        }),
    )


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    autocomplete_fields = ('instructor',)
    list_display = ('section_id', 'section_code', 'section_name', 'program', 'year_level', 'instructor', 'status')
    list_filter = ('program', 'year_level', 'status')
    search_fields = ('section_code', 'section_name', 'program', 'year_level', 'instructor__username', 'instructor__first_name', 'instructor__last_name')
    ordering = ('section_name',)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'instructor':
            kwargs['queryset'] = User.objects.filter(role=User.RoleChoices.INSTRUCTOR)
            field = super().formfield_for_foreignkey(db_field, request, **kwargs)
            if field is not None and hasattr(field.widget, 'attrs'):
                field.widget.attrs.update({'placeholder': 'Choose Instructor...', 'data-placeholder': 'Choose Instructor...'})
            return field
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


# -- Custom add forms for each profile type -------------------------------------------------


class StudentCreationForm(forms.ModelForm):
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput)
    password2 = forms.CharField(label='Password confirmation', widget=forms.PasswordInput)
    username = forms.CharField(required=False, label='Username')

    class Meta:
        model = StudentProfile
        fields = ('username', 'first_name', 'last_name', 'student_id', 'email', 'section', 'nfc_uid', 'profile_image', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.instance.role = User.RoleChoices.STUDENT

    def clean_password2(self):
        p1 = self.cleaned_data.get('password1')
        p2 = self.cleaned_data.get('password2')
        if p1 and p2 and p1 != p2:
            raise forms.ValidationError("Passwords don't match")
        return p2

    def save(self, commit=True):
        user = super().save(commit=False)
        # prefer explicit username from form, fallback to student_id or email
        user.username = self.cleaned_data.get('username') or user.student_id or user.email
        user.set_password(self.cleaned_data['password1'])
        user.role = User.RoleChoices.STUDENT
        user.is_staff = False
        try:
            user.full_clean()
        except forms.ValidationError:
            raise

        if commit:
            user.save()
            # Ensure the relation fields are saved
            self.save_m2m()
        return user


class InstructorCreationForm(forms.ModelForm):
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput)
    password2 = forms.CharField(label='Password confirmation', widget=forms.PasswordInput)

    instructor_id = forms.CharField(required=False, label='Instructor ID')
    username = forms.CharField(required=False, label='Username')

    class Meta:
        model = InstructorProfile
        fields = ('username', 'first_name', 'last_name', 'instructor_id', 'email', 'assigned_sections', 'nfc_uid', 'profile_image', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.instance.role = User.RoleChoices.INSTRUCTOR

    def clean_password2(self):
        p1 = self.cleaned_data.get('password1')
        p2 = self.cleaned_data.get('password2')
        if p1 and p2 and p1 != p2:
            raise forms.ValidationError("Passwords don't match")
        return p2

    def save(self, commit=True):
        sections = self.cleaned_data.get('assigned_sections', [])
        user = super().save(commit=False)
        # prefer explicit username from form, then instructor_id, then email
        user.username = self.cleaned_data.get('username') or self.cleaned_data.get('instructor_id') or user.instructor_id or user.email
        # set the instructor_id on the user if provided
        if self.cleaned_data.get('instructor_id'):
            user.instructor_id = self.cleaned_data.get('instructor_id')
        user.set_password(self.cleaned_data['password1'])
        user.role = User.RoleChoices.INSTRUCTOR
        user.is_staff = False
        # set nfc_uid if provided in the form
        if self.cleaned_data.get('nfc_uid'):
            user.nfc_uid = self.cleaned_data.get('nfc_uid')
        try:
            user.full_clean()
        except forms.ValidationError:
            raise
        if commit:
            user.save()
            # assign selected sections via the ManyToMany assigned_sections
            if sections:
                user.assigned_sections.set(sections)
                # also update Section.instructor FK for backward compatibility
                Section.objects.filter(instructor=user).exclude(pk__in=[s.pk for s in sections]).update(instructor=None)
                Section.objects.filter(pk__in=[s.pk for s in sections]).update(instructor=user)
            else:
                # clear assignments and unset the FK on sections that pointed to this user
                user.assigned_sections.clear()
                Section.objects.filter(instructor=user).update(instructor=None)
        return user


class AdminCreationForm(forms.ModelForm):
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput)
    password2 = forms.CharField(label='Password confirmation', widget=forms.PasswordInput)
    username = forms.CharField(required=False, label='Username')

    class Meta:
        model = AdminProfile
        fields = ('username', 'first_name', 'last_name', 'email', 'nfc_uid', 'profile_image', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.instance.role = User.RoleChoices.ADMIN

    def clean_password2(self):
        p1 = self.cleaned_data.get('password1')
        p2 = self.cleaned_data.get('password2')
        if p1 and p2 and p1 != p2:
            raise forms.ValidationError("Passwords don't match")
        return p2

    def save(self, commit=True):
        user = super().save(commit=False)
        # prefer explicit username, fallback to email
        user.username = self.cleaned_data.get('username') or user.email
        user.set_password(self.cleaned_data['password1'])
        user.role = User.RoleChoices.ADMIN
        user.is_staff = True
        user.is_superuser = True
        # ensure NFC set if provided
        if self.cleaned_data.get('nfc_uid'):
            user.nfc_uid = self.cleaned_data.get('nfc_uid')
        try:
            user.full_clean()
        except forms.ValidationError:
            raise
        if commit:
            user.save()
        return user


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    form = CustomUserChangeForm
    add_form = StudentCreationForm
    autocomplete_fields = ('section',)
    list_display = ('student_id', 'first_name', 'last_name', 'email', 'section', 'nfc_uid', 'is_active')
    search_fields = ('student_id', 'first_name', 'last_name', 'email')

    def get_fieldsets(self, request, obj=None):
        if obj:
            return (
                (None, {'fields': ('username', 'student_id', 'first_name', 'last_name', 'email', 'section', 'nfc_uid', 'profile_image', 'is_active')}),
            )
        return super().get_fieldsets(request, obj)

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            return self.add_form
        return super().get_form(request, obj, **kwargs)

    def save_model(self, request, obj, form, change):
        obj.role = User.RoleChoices.STUDENT
        obj.is_staff = False
        # Remove instructor-specific data when saving a student profile.
        obj.instructor_id = None
        super().save_model(request, obj, form, change)
        if obj.pk:
            obj.assigned_sections.clear()


@admin.register(InstructorProfile)
class InstructorProfileAdmin(admin.ModelAdmin):
    form = CustomUserChangeForm
    add_form = InstructorCreationForm
    autocomplete_fields = ('assigned_sections',)
    list_display = ('instructor_id', 'first_name', 'last_name', 'email', 'is_active')
    search_fields = ('instructor_id', 'first_name', 'last_name', 'email')

    # restrict displayed fields when editing an existing instructor
    def get_fieldsets(self, request, obj=None):
        if obj:
            return (
                (None, {'fields': ('username', 'instructor_id', 'first_name', 'last_name', 'email', 'assigned_sections', 'nfc_uid', 'profile_image', 'is_active')}),
            )
        return super().get_fieldsets(request, obj)

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            return self.add_form
        return super().get_form(request, obj, **kwargs)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        field = super().formfield_for_manytomany(db_field, request, **kwargs)
        if db_field.name == 'assigned_sections' and field is not None and hasattr(field.widget, 'attrs'):
            field.widget.attrs.update({'placeholder': 'Choose section...', 'data-placeholder': 'Choose section...'})
        return field

    def save_model(self, request, obj, form, change):
        obj.role = User.RoleChoices.INSTRUCTOR
        obj.is_staff = False
        # Remove student-specific data when saving an instructor profile.
        obj.student_id = None
        super().save_model(request, obj, form, change)
        # ensure assigned_sections M2M is synced to Section.instructor FK
        try:
            assigned = list(obj.assigned_sections.all())
            if assigned:
                Section.objects.filter(instructor=obj).exclude(pk__in=[s.pk for s in assigned]).update(instructor=None)
                Section.objects.filter(pk__in=[s.pk for s in assigned]).update(instructor=obj)
            else:
                Section.objects.filter(instructor=obj).update(instructor=None)
        except Exception:
            pass


@admin.register(AdminProfile)
class AdminProfileAdmin(admin.ModelAdmin):
    form = CustomUserChangeForm
    add_form = AdminCreationForm
    list_display = ('username', 'first_name', 'last_name', 'email', 'is_staff', 'is_superuser')
    search_fields = ('username', 'first_name', 'last_name', 'email')

    def get_fieldsets(self, request, obj=None):
        if obj:
            return (
                (None, {'fields': ('username', 'first_name', 'last_name', 'email', 'nfc_uid', 'profile_image', 'is_active', 'is_staff', 'is_superuser')}),
            )
        return super().get_fieldsets(request, obj)

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            return self.add_form
        return super().get_form(request, obj, **kwargs)

    def save_model(self, request, obj, form, change):
        obj.role = User.RoleChoices.ADMIN
        obj.is_staff = True
        obj.student_id = None
        obj.instructor_id = None
        super().save_model(request, obj, form, change)
        if obj.pk:
            obj.assigned_sections.clear()


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    autocomplete_fields = ('assigned_sections', 'assigned_instructor')
    list_display = ('title', 'created_by', 'assigned_instructor', 'due_date', 'created_at')
    list_filter = ('created_by', 'due_date')
    search_fields = ('title', 'description', 'assigned_instructor__first_name', 'assigned_instructor__last_name', 'created_by__first_name', 'created_by__last_name')
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'updated_at')
    date_hierarchy = 'created_at'

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        field = super().formfield_for_manytomany(db_field, request, **kwargs)
        if db_field.name == 'assigned_sections' and field is not None and hasattr(field.widget, 'attrs'):
            field.widget.attrs.update({'placeholder': 'Choose section...', 'data-placeholder': 'Choose section...'})
        return field

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'assigned_instructor':
            kwargs['queryset'] = User.objects.filter(role=User.RoleChoices.INSTRUCTOR)
            field = super().formfield_for_foreignkey(db_field, request, **kwargs)
            if field is not None and hasattr(field.widget, 'attrs'):
                field.widget.attrs.update({'placeholder': 'Choose Instructor...', 'data-placeholder': 'Choose Instructor...'})
            return field
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    autocomplete_fields = ('student',)
    list_display = ('activity', 'student', 'submitted_at', 'updated_at')
    list_filter = ('activity', 'student')
    search_fields = ('student__first_name', 'student__last_name', 'activity__title')
    ordering = ('-submitted_at',)
    readonly_fields = ('submitted_at', 'updated_at')
    date_hierarchy = 'submitted_at'

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'student':
            kwargs['queryset'] = User.objects.filter(role=User.RoleChoices.STUDENT)
            field = super().formfield_for_foreignkey(db_field, request, **kwargs)
            if field is not None and hasattr(field.widget, 'attrs'):
                field.widget.attrs.update({'placeholder': 'Choose student...', 'data-placeholder': 'Choose student...'})
            return field
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


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
