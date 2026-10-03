from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0025_nfcenrollmentsession'),
    ]

    operations = [
        migrations.RenameField(
            model_name='section',
            old_name='section_code',
            new_name='subject_code',
        ),
        migrations.AlterField(
            model_name='section',
            name='subject_code',
            field=models.CharField(blank=True, default='', max_length=50, verbose_name='Subject Code'),
        ),
        migrations.AlterModelOptions(
            name='section',
            options={'ordering': ['section_name', 'subject_code']},
        ),
    ]