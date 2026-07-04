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
print(f"Section ID: {student.section.section_id if student.section else 'None'}")
print()

# Check activities
if student.section:
    activities = Activity.objects.filter(section=student.section)
    print(f"Activities in {student.section.section_name}: {activities.count()}")
    for activity in activities:
        print(f"  - {activity.title} (ID: {activity.id})")
else:
    print("Student has no section")

print()
print("All Activities in DB:")
all_activities = Activity.objects.all()
print(f"Total activities: {all_activities.count()}")
for activity in all_activities[:5]:
    print(f"  - {activity.title} (Section: {activity.section})")
