from django.db import migrations, models


def normalize_activity_statuses(apps, schema_editor):
    Activity = apps.get_model('api', 'Activity')
    Activity.objects.filter(status__iexact='Active').update(status='Published')
    Activity.objects.filter(status__iexact='Scheduled').update(status='Draft')
    Activity.objects.filter(status__iexact='Expired').update(status='Closed')
    Activity.objects.filter(status__iexact='Completed').update(status='Closed')


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0042_activitydiscussionattachment'),
    ]

    operations = [
        migrations.RunPython(normalize_activity_statuses, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='activity',
            name='status',
            field=models.CharField(
                blank=True,
                choices=[
                    ('Draft', 'Draft'),
                    ('Published', 'Published'),
                    ('Closed', 'Closed'),
                    ('Archived', 'Archived'),
                ],
                default='Draft',
                max_length=30,
            ),
        ),
    ]