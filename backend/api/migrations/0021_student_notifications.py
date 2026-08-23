from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0020_activityannouncement'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='student',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='student_notifications',
                to='api.user',
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='instructor',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='notifications',
                to='api.user',
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='notification_type',
            field=models.CharField(
                choices=[
                    ('submission', 'Submission'),
                    ('resubmission', 'Resubmission'),
                    ('deadline', 'Deadline'),
                    ('access_log', 'Access Log'),
                    ('activity', 'Activity'),
                    ('announcement', 'Announcement'),
                    ('grade', 'Grade'),
                    ('feedback', 'Feedback'),
                ],
                default='submission',
                max_length=50,
            ),
        ),
    ]