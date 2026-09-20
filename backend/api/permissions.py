from rest_framework.permissions import BasePermission
import os


class IsAdminRole(BasePermission):
    message = 'Only administrators can perform this action.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'admin'


class IsInstructorRole(BasePermission):
    message = 'Only instructors can perform this action.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'instructor'


class IsStudentRole(BasePermission):
    message = 'Only students can perform this action.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'student'


class IsDiscussionAuthorOrInstructor(BasePermission):
    message = 'Only the author or an instructor can modify this discussion.'

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False
        if request.user.role in ('admin', 'instructor'):
            return True
        return obj.sender_id == request.user.id


class HasDeviceAPIKey(BasePermission):
    """
    Allows requests that present a valid device API key in the
    X-API-Key header. Used by ESP32 cabinet hardware to POST
    NFC verification requests without a JWT token.
    """
    message = 'Invalid or missing device API key.'

    def has_permission(self, request, view):
        expected = os.environ.get('DEVICE_API_KEY', '').strip()
        provided = (
            request.headers.get('X-API-Key')
            or request.META.get('HTTP_X_API_KEY', '')
        ).strip()

        # TEMP DEBUG - remove after diagnosing
        print("=" * 60)
        print("[DEBUG] expected key    :", repr(expected))
        print("[DEBUG] provided key    :", repr(provided))
        print("[DEBUG] request.headers :", dict(request.headers))
        print("=" * 60)

        if not expected:
            return False
        return provided == expected