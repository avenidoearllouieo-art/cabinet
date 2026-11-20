import os
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.files import File
from django.core.files.storage import FileSystemStorage
from django.core.management.base import BaseCommand, CommandError
from django.db.models import FileField


class Command(BaseCommand):
    help = 'Copy existing local media objects into the configured default storage without deleting source files.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--legacy-media-root',
            default=os.environ.get('DJANGO_LEGACY_MEDIA_ROOT') or str(settings.MEDIA_ROOT),
        )
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--fail-on-missing', action='store_true')

    def handle(self, *args, **options):
        source_root = Path(options['legacy_media_root']).expanduser().resolve()
        source_storage = FileSystemStorage(location=source_root)
        dry_run = options['dry_run']
        copied = 0
        already_present = 0
        missing = []

        for model in apps.get_models():
            file_fields = [field for field in model._meta.get_fields() if isinstance(field, FileField)]
            if not file_fields:
                continue

            for record in model.objects.only('pk').iterator():
                for field in file_fields:
                    stored_file = getattr(record, field.name)
                    storage_name = stored_file.name
                    if not storage_name:
                        continue

                    target_storage = field.storage
                    if target_storage.exists(storage_name):
                        already_present += 1
                        continue
                    try:
                        with source_storage.open(storage_name, 'rb') as source_file:
                            if dry_run:
                                copied += 1
                                continue
                            saved_name = target_storage.save(storage_name, File(source_file), max_length=field.max_length)
                    except (FileNotFoundError, OSError, ValueError):
                        missing.append(f'{model._meta.label}.{record.pk}.{field.name}: {storage_name}')
                        continue

                    if saved_name != storage_name:
                        target_storage.delete(saved_name)
                        raise CommandError(
                            f'Storage changed the key for {model._meta.label}.{record.pk}.{field.name}; '
                            'no database records were changed.'
                        )
                    copied += 1

        mode = 'Would copy' if dry_run else 'Copied'
        self.stdout.write(f'{mode} {copied} file(s); {already_present} already present; {len(missing)} missing locally.')
        for missing_file in missing:
            self.stderr.write(f'Missing: {missing_file}')
        if missing and options['fail_on_missing']:
            raise CommandError(f'{len(missing)} referenced local file(s) are missing; no recovery was attempted.')