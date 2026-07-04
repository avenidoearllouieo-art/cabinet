import os
import sys
sys.path.insert(0, 'c:\\Users\\Avenido\\CapstoneCabinet\\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
import json
import requests

User = get_user_model()

# Get a student user
student = User.objects.filter(role='student').first()
if not student:
    print("No student users found")
    exit(1)

print(f"Student: {student.username} ({student.id})")
print(f"Section: {student.section}")
print(f"Active: {student.is_active}")
print()

# Generate token for student
refresh = RefreshToken.for_user(student)
access_token = str(refresh.access_token)
print(f"Access token generated for student: {access_token[:50]}...")
print()

# Test dashboard endpoint
headers = {
    'Authorization': f'Bearer {access_token}',
    'Accept': 'application/json',
}

print("=" * 60)
print("Testing /api/dashboard/")
print("=" * 60)
try:
    response = requests.get('http://localhost:8000/api/dashboard/', headers=headers)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(json.dumps(data, indent=2, default=str)[:1500])
    else:
        print(f"Error: {response.text[:500]}")
except Exception as e:
    print(f"Exception: {e}")

print()
print("=" * 60)
print("Testing /api/activities/")
print("=" * 60)
try:
    response = requests.get('http://localhost:8000/api/activities/', headers=headers)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Response type: {type(data).__name__}")
        if isinstance(data, dict):
            print(f"Total activities: {data.get('count', 0)}")
            print(f"Page size: {data.get('page_size', 'N/A')}")
            if data.get('results'):
                print(f"First activity keys: {list(data['results'][0].keys())}")
                print(f"First activity: {json.dumps(data['results'][0], indent=2, default=str)[:1000]}")
        else:
            print(f"Unexpected response format: {json.dumps(data, indent=2, default=str)[:500]}")
    else:
        print(f"Error: {response.text[:500]}")
except Exception as e:
    print(f"Exception: {e}")

print()
print("=" * 60)
print("Testing /api/activities/stats/")
print("=" * 60)
try:
    response = requests.get('http://localhost:8000/api/activities/stats/', headers=headers)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(json.dumps(data, indent=2, default=str))
    else:
        print(f"Error: {response.text[:500]}")
except Exception as e:
    print(f"Exception: {e}")
