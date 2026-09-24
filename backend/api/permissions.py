from rest_framework.permissions import BasePermission
from rest_framework.throttling import AnonRateThrottle
import os
import logging

logger = logging.getLogger(__name__)


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

        logger.info(
            'Device API key diagnostics: django_key_configured=%s django_key_length=%d x_api_key_header_received=%s keys_match=%s',
            bool(expected),
            len(expected),
            bool(provided),
            bool(expected) and bool(provided) and provided == expected,
        )

        if not expected:
            return False
        return provided == expected


class PasswordResetRateThrottle(AnonRateThrottle):
    rate = '60/hour'

    def get_rate(self):
        return self.rate