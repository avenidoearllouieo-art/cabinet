"""Explicit local-test settings: never connects to the configured production DB."""
import os
import tempfile

os.environ['DJANGO_DEBUG'] = 'true'
os.environ['DJANGO_SECRET_KEY'] = 'taptrack-isolated-tests-only-not-a-production-secret'
os.environ['TAPTRACK_NFC_REGISTRATION_URL_BASE'] = 'http://localhost:5176/register'
os.environ['TAPTRACK_NFC_DEVICE_MAP'] = '[]'
os.environ['DJANGO_MEDIA_STORAGE_BACKEND'] = 'filesystem'

from .settings import *  # noqa: F403,E402

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
_test_media = tempfile.TemporaryDirectory(prefix='taptrack-identity-tests-')
MEDIA_ROOT = _test_media.name
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}
