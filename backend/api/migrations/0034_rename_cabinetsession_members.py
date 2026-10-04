from django.db import migrations, models


def copy_legacy_members(apps, schema_editor):
    CabinetSession = apps.get_model('api', 'CabinetSession')
    for session in CabinetSession.objects.exclude(opened_by__isnull=True).iterator():
        session.participants.add(session.opened_by_id)
    for session in CabinetSession.objects.exclude(closed_by__isnull=True).iterator():
        session.closing_participants.add(session.closed_by_id)


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0033_nfcenrollmentsession_cabinet_name_and_more'),
    ]

    operations = [
        migrations.RunPython(copy_legacy_members, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='cabinetsession',
            name='opened_by',
        ),
        migrations.RemoveField(
            model_name='cabinetsession',
            name='closed_by',
        ),
        migrations.RenameField(
            model_name='cabinetsession',
            old_name='participants',
            new_name='opened_by',
        ),
        migrations.RenameField(
            model_name='cabinetsession',
            old_name='closing_participants',
            new_name='closed_by',
        ),
        migrations.AlterField(
            model_name='cabinetsession',
            name='opened_by',
            field=models.ManyToManyField(blank=True, related_name='opened_cabinet_sessions', to='api.user'),
        ),
        migrations.AlterField(
            model_name='cabinetsession',
            name='closed_by',
            field=models.ManyToManyField(blank=True, related_name='closed_cabinet_sessions', to='api.user'),
        ),
    ]