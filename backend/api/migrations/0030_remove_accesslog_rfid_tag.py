from django.db import migrations, models


def copy_legacy_nfc_uids(apps, schema_editor):
    AccessLog = apps.get_model('api', 'AccessLog')
    AccessLog.objects.using(schema_editor.connection.alias).filter(
        nfc_uid='',
    ).exclude(rfid_tag='').update(nfc_uid=models.F('rfid_tag'))


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0029_cabinetsession_participants'),
    ]

    operations = [
        migrations.RunPython(copy_legacy_nfc_uids, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='accesslog',
            name='rfid_tag',
        ),
    ]