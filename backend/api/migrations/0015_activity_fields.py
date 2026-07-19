from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_remove_locker_station_2'),
    ]

    operations = [
        migrations.AddField(
            model_name='activity',
            name='activity_type',
            field=models.CharField(blank=True, default='Assignment', max_length=50),
        ),
        migrations.AddField(
            model_name='activity',
            name='assigned_instructor',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_activities', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='activity',
            name='assigned_sections',
            field=models.ManyToManyField(blank=True, related_name='assigned_activities', to='api.section'),
        ),
        migrations.AddField(
            model_name='activity',
            name='cabinet_station',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='activity',
            name='status',
            field=models.CharField(blank=True, default='Published', max_length=30),
        ),
    ]
