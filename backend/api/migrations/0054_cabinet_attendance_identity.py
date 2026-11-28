from django.db import migrations, models
import django.db.models.deletion


def backfill_attendance(apps, schema_editor):
    CabinetSession = apps.get_model('api', 'CabinetSession')
    CabinetSessionAttendance = apps.get_model('api', 'CabinetSessionAttendance')
    AccessLog = apps.get_model('api', 'AccessLog')

    sessions = CabinetSession.objects.using(schema_editor.connection.alias).all().iterator(chunk_size=500)
    for session in sessions:
        opening_logs = AccessLog.objects.using(schema_editor.connection.alias).filter(
            cabinet_session_id=session.pk,
            action='open',
            status='success',
        ).select_related('user').order_by('access_time', 'pk')
        opening_log = opening_logs.first()

        opening_users = set(session.opened_by.values_list('pk', flat=True))
        opening_users.update(opening_logs.exclude(user_id=None).values_list('user_id', flat=True))

        closing_logs = AccessLog.objects.using(schema_editor.connection.alias).filter(
            cabinet_session_id=session.pk,
            action='close',
            status='success',
        ).select_related('user').order_by('access_time', 'pk')
        closing_log = closing_logs.first()

        closing_users = set(session.closed_by.values_list('pk', flat=True))
        closing_users.update(closing_logs.exclude(user_id=None).values_list('user_id', flat=True))

        for user_id in opening_users:
            session.opened_by.add(user_id)
            opened_at = None
            log = opening_logs.filter(user_id=user_id).first()
            if log:
                opened_at = log.access_time
            CabinetSessionAttendance.objects.using(schema_editor.connection.alias).update_or_create(
                session_id=session.pk,
                user_id=user_id,
                defaults={'opened_attended_at': opened_at},
            )

        for user_id in closing_users:
            session.closed_by.add(user_id)
            closed_at = None
            log = closing_logs.filter(user_id=user_id).first()
            if log:
                closed_at = log.access_time
            attendance, _ = CabinetSessionAttendance.objects.using(schema_editor.connection.alias).get_or_create(
                session_id=session.pk,
                user_id=user_id,
            )
            attendance.closed_attended_at = closed_at
            attendance.save(update_fields=['closed_attended_at'])

        if not session.session_initiator_id and opening_log and opening_log.user_id:
            session.session_initiator_id = opening_log.user_id
        # An M2M relation proves participation, but does not prove who initiated.

        if not session.closing_initiator_id and closing_log and closing_log.user_id:
            session.closing_initiator_id = closing_log.user_id
        # An M2M relation proves closing participation only; it does not identify a closing initiator.

        session.participant_count = len(opening_users)
        session.save(update_fields=['session_initiator', 'closing_initiator', 'participant_count'])


class Migration(migrations.Migration):
    dependencies = [('api', '0053_enforce_cabinetsession_identity')]

    operations = [
        migrations.AddField(
            model_name='cabinetsession',
            name='session_initiator',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='initiated_cabinet_sessions', to='api.user'),
        ),
        migrations.AddField(
            model_name='cabinetsession',
            name='closing_initiator',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='closing_initiated_cabinet_sessions', to='api.user'),
        ),
        migrations.CreateModel(
            name='CabinetSessionAttendance',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('opened_attended_at', models.DateTimeField(blank=True, null=True)),
                ('closed_attended_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_records', to='api.cabinetsession')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cabinet_attendance_records', to='api.user')),
            ],
        ),
        migrations.AddConstraint(
            model_name='cabinetsessionattendance',
            constraint=models.UniqueConstraint(fields=('session', 'user'), name='uniq_cabinet_session_attendance'),
        ),
        migrations.AddIndex(
            model_name='cabinetsessionattendance',
            index=models.Index(fields=['session', 'opened_attended_at'], name='api_cabinets_sessio_4d0c09_idx'),
        ),
        migrations.AddIndex(
            model_name='cabinetsessionattendance',
            index=models.Index(fields=['session', 'closed_attended_at'], name='api_cabinets_sessio_07a0d1_idx'),
        ),
        migrations.RunPython(backfill_attendance, reverse_code=migrations.RunPython.noop),
    ]
