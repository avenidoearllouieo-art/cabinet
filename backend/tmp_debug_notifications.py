import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from api.models import Notification, Activity, User
print('Notification count:', Notification.objects.count())
for n in Notification.objects.all()[:20]:
    print(n.id, n.instructor_id, n.title, n.notification_type, n.notification_key, n.is_read)
print('---activities---')
for a in Activity.objects.all()[:20]:
    print(a.id, a.title, a.created_by_id)
print('---instructors---')
for i in User.objects.filter(role='instructor')[:20]:
    print(i.id, i.username, i.first_name, i.last_name)
