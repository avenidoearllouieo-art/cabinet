"""CI runner for existing in-process HTTP fixtures using production settings."""

from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings
from django.test.runner import DiscoverRunner


class CIHttpTestRunner(DiscoverRunner):
    def run_tests(self, test_labels, **kwargs):
        database = settings.DATABASES.get("default", {})
        test_database = database.get("TEST", {})
        if (
            set(settings.DATABASES) != {"default"}
            or database.get("ENGINE") != "django.db.backends.sqlite3"
            or database.get("NAME") != ":memory:"
            or test_database.get("NAME") not in (None, ":memory:")
            or test_database.get("MIRROR")
            or database.get("OPTIONS", {}).get("init_command")
        ):
            raise ImproperlyConfigured("The CI test runner requires in-memory SQLite.")

        # The test client uses HTTP. Keep the redirect in system checks and in
        # subprocesses that load production settings, along with all auth guards.
        with TemporaryDirectory(prefix="taptrack-ci-") as directory:
            media = Path(directory) / "media"
            uploads = Path(directory) / "uploads"
            media.mkdir()
            uploads.mkdir()
            with override_settings(
                SECURE_SSL_REDIRECT=False,
                EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                MEDIA_STORAGE_BACKEND="filesystem",
                MEDIA_ROOT=media,
                FILE_UPLOAD_TEMP_DIR=str(uploads),
                STORAGES={
                    **settings.STORAGES,
                    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                },
            ):
                return super().run_tests(test_labels, **kwargs)
