#!/usr/bin/env python
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()
students = User.objects.filter(role='student')
print(f'Total students: {students.count()}')
for s in students:
    print(f'ID: {s.id}, Username: {s.username}, StudentID: {s.student_id}, Email: {s.email}')
