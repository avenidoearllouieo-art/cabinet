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


class IsDiscussionAuthorOrInstructor(BasePermission):
    """Allow only message owners or instructors/admins to edit/delete discussion messages."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if view.action in ['update', 'partial_update', 'destroy']:
            user = getattr(request, 'user', None)
            if not user or not user.is_authenticated:
                return False
            return obj.sender == user or getattr(user, 'role', None) in ['instructor', 'admin']
        return True


class IsStudentRole(BasePermission):
    """Allow access only to users with role 'student'."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'student')
