from rest_framework.permissions import BasePermission
from rest_framework.throttling import AnonRateThrottle
import os
import logging
import hmac
from django.conf import settings

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
    Allows requests from configured NFC readers or the development device key.
    """
    message = 'Invalid or missing device API key.'

    def has_permission(self, request, view):
        expected = os.environ.get('DEVICE_API_KEY', '').strip()
        provided = (
            request.headers.get('X-API-Key')
            or request.META.get('HTTP_X_API_KEY', '')
        ).strip()

        if settings.DEBUG and request.headers.get('X-TapTrack-Mock-Mode') == 'true':
            if not expected or not hmac.compare_digest(provided, expected):
                return False
            request.nfc_device_context = {
                'station': '',
                'cabinet_name': settings.TAPTRACK_CABINET_NAME,
                'device_id': 'MOCK-LAPTOP',
                'mock': True,
            }
            return True

        logger.info(
            'Device API key diagnostics: django_key_configured=%s django_key_length=%d x_api_key_header_received=%s keys_match=%s',
            bool(expected),
            len(expected),
            bool(provided),
            bool(expected) and bool(provided) and provided == expected,
        )

        mapped_device = next((
            device for device in settings.TAPTRACK_NFC_DEVICE_MAP
            if isinstance(device, dict)
            and device.get('api_key')
            and hmac.compare_digest(provided, str(device['api_key']))
        ), None)
        if mapped_device and mapped_device.get('active') is True:
            request.nfc_device_context = {
                'device_id': str(mapped_device['device_id']).strip(),
                'station': str(mapped_device.get('station') or '').strip(),
                'cabinet_name': str(mapped_device.get('cabinet_name') or '').strip(),
                'mock': False,
            }
            return True
        if mapped_device:
            return False
        if not expected or not hmac.compare_digest(provided, expected):
            return False
        request.nfc_device_context = {
            'station': '',
            'cabinet_name': settings.TAPTRACK_CABINET_NAME,
            'device_id': 'MOCK-LAPTOP',
            'mock': settings.DEBUG,
        }
        return settings.DEBUG


class PasswordResetRateThrottle(AnonRateThrottle):
    rate = '60/hour'

    def get_rate(self):
        return self.rate