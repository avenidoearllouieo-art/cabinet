from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError


def validate_taptrack_password(password, user):
    if user.password and check_password(password, user.password):
        raise ValidationError('Your new password must be different from your current password.')

    validate_password(password, user=user)

    if not (
        any(character.isupper() for character in password)
        and any(character.islower() for character in password)
        and any(character.isdigit() for character in password)
        and any(not character.isalnum() for character in password)
    ):
        raise ValidationError('Use upper- and lowercase letters, a number, and a symbol.')