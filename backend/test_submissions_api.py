#!/usr/bin/env python
"""
Test script for Student Submissions API
Tests the stats endpoint and submission list endpoint
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(__file__))
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model
import json

User = get_user_model()

def test_submissions_api():
    """Test submissions endpoints"""
    client = Client()
    
    # Get a test student
    student = User.objects.filter(role='student', student_id='louie').first()
    if not student:
        print("❌ No test student found. Create one first.")
        return
    
    print(f"✓ Found test student: {student.first_name} {student.last_name} (ID: {student.student_id})")
    
    # Force login using sessions (bypass token auth for testing)
    client.force_login(student)
    
    # Test 1: GET /api/submissions/stats/
    print("\n📊 Testing: GET /api/submissions/stats/")
    response = client.get('/api/submissions/stats/', HTTP_AUTHORIZATION=f'Bearer {student.id}')
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"   Response: {json.dumps(data, indent=2)}")
        print("   ✓ Stats endpoint working!")
    else:
        print(f"   ❌ Error: {response.content.decode()}")
    
    # Test 2: GET /api/submissions/
    print("\n📋 Testing: GET /api/submissions/")
    response = client.get('/api/submissions/')
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"   Count: {data.get('count', 0)} submissions")
        if data.get('results'):
            print(f"   First submission: {data['results'][0].get('activity', {})}")
        print("   ✓ Submissions list working!")
    else:
        print(f"   ❌ Error: {response.content.decode()}")

if __name__ == '__main__':
    test_submissions_api()
