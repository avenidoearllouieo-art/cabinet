import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from api.models import Activity, Notification
from api.views import create_activity_notification

activity = Activity.objects.filter(created_by__role='instructor').last()
print('Activity:', activity.id if activity else None, activity.title if activity else None, activity.created_by_id if activity else None)
try:
    n = create_activity_notification(activity)
    print('Returned:', n)
    print('Count after:', Notification.objects.count())
    if n:
        print('Notif created', n.id, n.title, n.notification_type, n.notification_key)
except Exception as e:
    print('Exception:', type(e).__name__, e)
