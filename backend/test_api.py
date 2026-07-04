import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model
import json

User = get_user_model()

# Get instructor user
instructor = User.objects.get(username='instructor')
print(f'Instructor user ID: {instructor.id}')
print(f'Instructor role: {instructor.role}')

# Create a test client
client = Client()

# First, get a token
from rest_framework_simplejwt.tokens import RefreshToken
refresh = RefreshToken.for_user(instructor)
access_token = str(refresh.access_token)
print(f'Generated access token: {access_token[:50]}...')

# Make request to activities endpoint
response = client.get(
    '/api/activities/',
    HTTP_AUTHORIZATION=f'Bearer {access_token}',
    HTTP_ACCEPT='application/json'
)

print(f'\nAPI Response Status: {response.status_code}')
print(f'API Response Content-Type: {response.get("Content-Type", "N/A")}')
print(f'API Response Length: {len(response.content)} bytes')

try:
    data = response.json()
    print(f'\nResponse Data Type: {type(data).__name__}')
    print(f'\nFirst 1000 chars of response:')
    print(json.dumps(data, indent=2)[:1000])
    print(f'\nTotal activities returned: {len(data) if isinstance(data, list) else len(data.get("results", []))}')
except Exception as e:
    print(f'Error parsing JSON: {e}')
    print(f'Response content: {response.content[:500]}')
