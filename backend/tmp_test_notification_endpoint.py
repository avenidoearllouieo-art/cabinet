import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory, force_authenticate
from api.views import NotificationViewSet

User = get_user_model()
user = User.objects.filter(role='instructor').first()
print('Instructor:', user.id, user.username, user.role)

factory = APIRequestFactory()
request = factory.get('/notifications/')
force_authenticate(request, user=user)
view = NotificationViewSet.as_view({'get': 'list'})
response = view(request)
print('Status:', response.status_code)
print('Data:', response.data)
