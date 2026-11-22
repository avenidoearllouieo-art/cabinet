from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError


def validate_taptrack_password(password, user):
    if user.password and user.check_password(password):
        raise ValidationError('Your new password must be different from your current password.')

    validate_password(password, user=user)