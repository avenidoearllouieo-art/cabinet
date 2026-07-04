import os
import sys
sys.path.insert(0, 'c:\\Users\\Avenido\\CapstoneCabinet\\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from django.test import Client
import json

User = get_user_model()

# Get a student user
student = User.objects.filter(role='student').first()
if not student:
    print("No student users found")
    exit(1)

# Generate token for student
refresh = RefreshToken.for_user(student)
access_token = str(refresh.access_token)

# Create a test client
client = Client()

# Make request to activities endpoint
response = client.get(
    '/api/activities/',
    HTTP_AUTHORIZATION=f'Bearer {access_token}',
    HTTP_ACCEPT='application/json'
)

print(f"Status: {response.status_code}")
print(f"Content-Type: {response.get('Content-Type', 'N/A')}")
print(f"Response type: {type(response.data).__name__ if hasattr(response, 'data') else 'unknown'}")
print()
print("Raw response:")
print(json.dumps(response.data if hasattr(response, 'data') else response.json(), indent=2, default=str)[:1500])
