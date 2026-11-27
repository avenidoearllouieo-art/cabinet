import uuid
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0052_backfill_cabinetsession_identity')]
    operations = [
        migrations.AlterField(
            model_name='cabinetsession', name='session_uuid',
            field=models.UUIDField(default=uuid.uuid4, unique=True, editable=False),
        ),
        migrations.AlterField(
            model_name='cabinetsession', name='motor_dispatch_eligible',
            field=models.BooleanField(default=True, editable=False),
        ),
    ]
