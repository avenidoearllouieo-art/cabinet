# TapTrack Development Test Data

This fixture is for isolated development/test databases only. It creates:

- Section `TAP-TEST-2026` (`TapTrack Development Test Section`).
- Student `Jordan Santos`, student ID `TAPTRACK-TEST-001`, username `taptrack_test_student`, with no assigned NFC UID and no usable password. The row represents a roster student awaiting enrollment.
- One pending `NFCEnrollmentSession` for test UID `1268010402`, initially without a usable token.

Use test card UID `1268010402` with this flow. The first normal `POST /api/verify-nfc/` scan remains unregistered and Django generates a real short-lived enrollment token for the pending session. Submit that token with student ID `TAPTRACK-TEST-001` through the existing enrollment registration flow. Django validates the registration, attaches the card UID, and a later scan returns Jordan Santos's registered student details. Do not preassign the UID to the student record; doing so would skip the unregistered-card flow.

From the `backend` directory, load the fixture with:

```bash
python manage.py loaddata taptrack_test_data
```

The fixed primary keys make repeated loads update the same three fixture records rather than add duplicates. Reloading after registration resets the roster user and enrollment session to their original pending states. Django-generated access logs are separate audit records and are not removed by reloading this fixture.

To remove the fixture records and enrollment session created for this test UID, run this only against the isolated development/test database:

```bash
python manage.py shell -c "from api.models import NFCEnrollmentSession, Section, User; NFCEnrollmentSession.objects.filter(pk=990001, nfc_uid='1268010402').delete(); User.objects.filter(pk=990001, username='taptrack_test_student').delete(); Section.objects.filter(pk=990001, subject_code='TAP-TEST-2026').delete()"
```

This cleanup does not delete Django access-log or cabinet-event audit records.