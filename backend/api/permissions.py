from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Allow access only to users with role 'admin'."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'admin')


class IsInstructorRole(BasePermission):
    """Allow access only to users with role 'instructor'."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'instructor')


class IsStudentRole(BasePermission):
    """Allow access only to users with role 'student'."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'student')
