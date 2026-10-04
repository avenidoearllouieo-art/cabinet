import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0026_rename_section_code_subject_code'),
    ]

    operations = [
        migrations.CreateModel(
            name='CabinetSession',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('station', models.CharField(blank=True, default='', max_length=100)),
                ('status', models.CharField(choices=[('open', 'Open'), ('closed', 'Closed')], default='open', max_length=20)),
                ('opened_at', models.DateTimeField(auto_now_add=True)),
                ('closed_at', models.DateTimeField(blank=True, null=True)),
                ('participant_count', models.PositiveIntegerField(default=0)),
                ('notes', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('closed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='closed_cabinet_sessions', to='api.user')),
                ('opened_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='opened_cabinet_sessions', to='api.user')),
            ],
            options={
                'ordering': ['-opened_at'],
            },
        ),
        migrations.AddField(
            model_name='accesslog',
            name='action',
            field=models.CharField(choices=[('verify', 'Verify'), ('open', 'Open'), ('close', 'Close'), ('register', 'Register'), ('access', 'Access')], default='verify', max_length=20),
        ),
        migrations.AddField(
            model_name='accesslog',
            name='cabinet_session',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='access_logs', to='api.cabinetsession'),
        ),
        migrations.AddField(
            model_name='accesslog',
            name='nfc_uid',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='accesslog',
            name='station',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AlterField(
            model_name='accesslog',
            name='status',
            field=models.CharField(choices=[('success', 'Success'), ('failed', 'Failed'), ('unregistered', 'Unregistered'), ('duplicate', 'Duplicate'), ('rejected', 'Rejected')], default='success', max_length=20),
        ),
        migrations.AddIndex(
            model_name='accesslog',
            index=models.Index(fields=['nfc_uid', 'status'], name='api_accessl_nfc_uid_8d0d6c_idx'),
        ),
        migrations.AddIndex(
            model_name='accesslog',
            index=models.Index(fields=['cabinet_session', 'status'], name='api_accessl_cabinet__fe9d83_idx'),
        ),
        migrations.AddIndex(
            model_name='accesslog',
            index=models.Index(fields=['station', 'access_time'], name='api_accessl_station_9f0e4b_idx'),
        ),
    ]
