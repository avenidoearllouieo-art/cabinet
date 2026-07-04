import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from api.models import Activity, User, Notification
from api.views import create_notification

activity = Activity.objects.filter(created_by__role='instructor').last()
print('Activity:', activity.id if activity else None, activity.title if activity else None, activity.created_by_id if activity else None)
if not activity:
    raise SystemExit('No activity found')

instructor = activity.created_by
print('Instructor:', instructor.id, instructor.username, instructor.role)

key = f'activity-created-{activity.id}-{instructor.id}'
print('Notification key:', key)

existing = Notification.objects.filter(notification_key=key)
print('Existing notifications with key:', existing.count())
for n in existing:
    print('  existing', n.id, n.title, n.notification_type, n.link, n.is_read)

try:
    n = create_notification(instructor, 'Test notification', 'testing', Notification.TypeChoices.DEADLINE, key, '/instructor/activities')
    print('create_notification returned:', n)
    if n:
        print('  created', n.id, n.title, n.notification_type, n.notification_key, n.link)
except Exception as exc:
    print('Exception in create_notification:', type(exc).__name__, exc)

print('Final Notification count:', Notification.objects.count())
