import os
import sys
sys.path.insert(0, 'c:\\Users\\Avenido\\CapstoneCabinet\\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.contrib.auth import get_user_model
from api.models import Activity, Section

User = get_user_model()

# Get a student user
student = User.objects.filter(role='student').first()
if not student:
    print("No student users found")
    exit(1)

print(f"Student: {student.username}")
print(f"Section: {student.section}")
print()

# Get all activities without section
activities = Activity.objects.filter(section__isnull=True)
print(f"Activities without section: {activities.count()}")

# Assign them to the student's section
if student.section and activities.exists():
    count = activities.update(section=student.section)
    print(f"Assigned {count} activities to section {student.section.section_name}")
else:
    print("No activities to assign or student has no section")

print()
print("Activities now in student's section:")
assigned = Activity.objects.filter(section=student.section)
for activity in assigned:
    print(f"  - {activity.title}")
