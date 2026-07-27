import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from api.models import User, Activity

student = User.objects.filter(role='student').first()
activity = Activity.objects.first()
print('student', student and student.id, student and student.username, 'section', getattr(student.section, 'id', None), getattr(student.section, 'section_name', None))
print('activity', activity and activity.id, activity and activity.title, 'section', getattr(activity.section, 'id', None), getattr(activity.section, 'section_name', None))
if not student or not activity:
    raise SystemExit('Missing student or activity')

refresh = RefreshToken.for_user(student)
access = str(refresh.access_token)
client = APIClient()
client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
resp = client.get(f'/api/activity-discussions/', {'activity': activity.id, 'ordering': 'created_at'})
print('status', resp.status_code)
print('data', resp.data)
print('headers', resp._headers if hasattr(resp, '_headers') else {})

print('\nCreating a new discussion message...')
resp2 = client.post('/api/activity-discussions/', {'activity': activity.id, 'message': 'Test discussion message from automated backend check.'}, format='json')
print('create status', resp2.status_code)
print('create data', resp2.data)

resp3 = client.get(f'/api/activity-discussions/', {'activity': activity.id, 'ordering': 'created_at'})
print('list after create status', resp3.status_code)
print('list after create data', resp3.data)
