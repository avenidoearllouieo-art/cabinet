from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0034_rename_cabinetsession_members'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='cabinetsession',
            constraint=models.UniqueConstraint(
                fields=('station',),
                condition=Q(status='open') & ~Q(station=''),
                name='uniq_open_cabinetsession_station',
            ),
        ),
    ]