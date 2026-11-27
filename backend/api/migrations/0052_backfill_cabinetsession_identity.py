import uuid
from django.db import migrations


def assign_legacy_identities(apps, schema_editor):
    sessions = apps.get_model('api', 'CabinetSession').objects.using(schema_editor.connection.alias)
    # Historical models intentionally bypass the current immutable model guard.
    # Do not regenerate a UUID on a resumed migration or change session history.
    for pk in sessions.filter(session_uuid__isnull=True).values_list('pk', flat=True).iterator(chunk_size=500):
        sessions.filter(pk=pk, session_uuid__isnull=True).update(
            session_uuid=uuid.uuid4(), motor_dispatch_eligible=False,
        )


class Migration(migrations.Migration):
    dependencies = [('api', '0051_cabinetsession_identity_fields')]
    operations = [migrations.RunPython(assign_legacy_identities, reverse_code=migrations.RunPython.noop)]
