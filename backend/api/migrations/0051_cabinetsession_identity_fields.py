from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0050_alter_user_options')]
    operations = [
        migrations.AddField(
            model_name='cabinetsession', name='session_uuid',
            field=models.UUIDField(null=True, editable=False),
        ),
        migrations.AddField(
            model_name='cabinetsession', name='motor_dispatch_eligible',
            field=models.BooleanField(default=False, editable=False),
        ),
    ]
