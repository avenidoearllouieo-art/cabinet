#!/usr/bin/env python
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

# Get the student user
user = User.objects.get(username='louie')

# Set password
user.set_password('louie')
user.save()

print(f"Password set for user 'louie'")
print(f"User is_active: {user.is_active}")
print(f"User role: {user.role}")
print(f"User has_usable_password: {user.has_usable_password()}")
