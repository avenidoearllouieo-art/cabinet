import json
import os


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

    import django
    django.setup()

    from django.contrib.auth import get_user_model
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken

    user_model = get_user_model()
    instructor = user_model.objects.get(username='instructor')
    print(f'Instructor user ID: {instructor.id}')
    print(f'Instructor role: {instructor.role}')

    access_token = str(RefreshToken.for_user(instructor).access_token)
    client = Client()
    response = client.get(
        '/api/activities/',
        HTTP_AUTHORIZATION=f'Bearer {access_token}',
        HTTP_ACCEPT='application/json',
    )

    print(f'\nAPI Response Status: {response.status_code}')
    print(f'API Response Content-Type: {response.get("Content-Type", "N/A")}')
    print(f'API Response Length: {len(response.content)} bytes')

    try:
        data = response.json()
        print(f'\nResponse Data Type: {type(data).__name__}')
        print('\nFirst 1000 chars of response:')
        print(json.dumps(data, indent=2)[:1000])
        print(f'\nTotal activities returned: {len(data) if isinstance(data, list) else len(data.get("results", []))}')
    except ValueError as exc:
        print(f'Error parsing JSON: {exc}')
        print(f'Response content: {response.content[:500]}')


if __name__ == '__main__':
    main()
