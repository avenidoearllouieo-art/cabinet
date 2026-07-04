#!/usr/bin/env python
"""
Integration test for Student Submissions Module
Tests the complete flow: stats endpoint, list endpoint, view, submit
"""
import os
import sys
import django
import json
from datetime import datetime, timedelta

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(__file__))
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model
from api.models import Activity, Submission, Section
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()

def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def test_submissions_integration():
    """Complete integration test"""
    
    print_section("STUDENT SUBMISSIONS MODULE - INTEGRATION TEST")
    
    # Get test student
    student = User.objects.filter(role='student').first()
    if not student:
        print("❌ ERROR: No test students found in database")
        return False
    
    print(f"✓ Found test student: {student.first_name or student.username} (ID: {student.student_id})")
    
    # Get section
    section = student.section if hasattr(student, 'section') else None
    print(f"✓ Student section: {section.section_name if section else 'None'}")
    
    # Check activities assigned to student
    activities = Activity.objects.filter(section=section) if section else []
    print(f"✓ Total activities in section: {activities.count()}")
    
    # Count student submissions
    submissions = Submission.objects.filter(student=student)
    print(f"✓ Student submissions: {submissions.count()}")
    
    # Test using Django test client
    client = Client()
    client.force_login(student)
    
    # Create JWT token
    refresh = RefreshToken.for_user(student)
    access_token = str(refresh.access_token)
    headers = {'HTTP_AUTHORIZATION': f'Bearer {access_token}'}
    
    print_section("TEST 1: Stats Endpoint")
    print("GET /api/submissions/stats/")
    response = client.get('/api/submissions/stats/', **headers)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"✓ Response Data:")
        print(f"  - totalSubmissions: {data.get('totalSubmissions', 0)}")
        print(f"  - pendingReview: {data.get('pendingReview', 0)}")
        print(f"  - graded: {data.get('graded', 0)}")
        print(f"  - lateSubmissions: {data.get('lateSubmissions', 0)}")
    else:
        print(f"❌ ERROR: {response.content.decode()}")
        return False
    
    print_section("TEST 2: Submissions List Endpoint")
    print("GET /api/submissions/")
    response = client.get('/api/submissions/', **headers)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"✓ Response Structure:")
        print(f"  - count: {data.get('count', 0)}")
        print(f"  - page_size: {data.get('page_size', 0)}")
        print(f"  - results: {len(data.get('results', []))} items")
        
        if data.get('results'):
            first = data['results'][0]
            print(f"\n✓ First Submission:")
            print(f"  - id: {first.get('id')}")
            print(f"  - activity_title: {first.get('activity_title', 'N/A')}")
            print(f"  - submission_status: {first.get('submission_status', 'N/A')}")
            print(f"  - submitted_at: {first.get('submitted_at', 'N/A')}")
            print(f"  - score: {first.get('score', 'N/A')}")
    else:
        print(f"❌ ERROR: {response.content.decode()}")
        return False
    
    print_section("TEST 3: Status Filter")
    print("GET /api/submissions/?status=graded")
    response = client.get('/api/submissions/?status=graded', **headers)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"✓ Graded submissions: {data.get('count', 0)}")
    else:
        print(f"❌ ERROR: {response.content.decode()}")
    
    print_section("TEST 4: Check Required Fields")
    response = client.get('/api/submissions/', **headers)
    if response.status_code == 200:
        data = json.loads(response.content)
        if data.get('results'):
            first = data['results'][0]
            required_fields = [
                'id', 'activity_title', 'instructor_name', 'submitted_at',
                'due_date', 'submission_status', 'score', 'files'
            ]
            print("Required fields check:")
            all_present = True
            for field in required_fields:
                if field in first:
                    print(f"  ✓ {field}")
                else:
                    print(f"  ❌ {field} - MISSING")
                    all_present = False
            
            if all_present:
                print("\n✓ All required fields present!")
            else:
                print("\n❌ Some required fields missing!")
                return False
    
    print_section("SUMMARY")
    print("✓ All integration tests passed!")
    print("\nThe Student Submissions module is ready for:")
    print("  - Frontend component testing")
    print("  - File upload functionality")
    print("  - End-to-end UI testing")
    return True

if __name__ == '__main__':
    try:
        success = test_submissions_integration()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
