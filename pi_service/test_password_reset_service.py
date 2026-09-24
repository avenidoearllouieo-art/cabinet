import unittest

from password_reset_service import Handoff, MockDisplay, MockNFCScanner, PasswordResetController


class FakeDjangoClient:
    def __init__(self):
        self.claimed_request_ids = []
        self.verified_cards = []
        self.registered_students = []

    def claim_handoff(self, request_id):
        self.claimed_request_ids.append(request_id)
        return Handoff(request_id=request_id, student_id='STU-001', expires_at='future')

    def verify_nfc(self, handoff, nfc_uid):
        self.verified_cards.append((handoff.request_id, handoff.student_id, nfc_uid))
        return 'token-kept-inside-device'

    def verify_access(self, nfc_uid):
        return {'success': True, 'name': 'Student One', 'student_id': 'STU-001', 'role': 'student'}

    def register_student(self, full_name, student_id, email, section, nfc_uid):
        self.registered_students.append((full_name, student_id, email, section, nfc_uid))
        return {'id': 1, 'student_id': student_id}


class FakeScanner:
    def scan_uid(self):
        return 'NFC-001'


class FakeDisplay:
    def __init__(self):
        self.messages = []
        self.codes = []

    def show_message(self, title, message):
        self.messages.append((title, message))

    def show_reset_code(self, reset_token, expires_at):
        self.codes.append((reset_token, expires_at))


class PasswordResetServiceTests(unittest.TestCase):
    def test_handoff_claims_request_and_verifies_card_without_browser_response(self):
        django = FakeDjangoClient()
        display = FakeDisplay()
        controller = PasswordResetController(django, FakeScanner(), display)

        handoff = controller.accept_handoff('request-123')
        controller.verify_active_card()

        self.assertEqual(handoff.request_id, 'request-123')
        self.assertEqual(django.claimed_request_ids, ['request-123'])
        self.assertEqual(django.verified_cards, [('request-123', 'STU-001', 'NFC-001')])
        self.assertEqual(display.codes, [('token-kept-inside-device', 'future')])
        self.assertIsNone(controller._active_handoff)

    def test_only_one_local_handoff_can_be_active(self):
        controller = PasswordResetController(FakeDjangoClient(), FakeScanner(), FakeDisplay())
        controller.accept_handoff('request-123')

        with self.assertRaises(RuntimeError):
            controller.accept_handoff('request-456')

    def test_invalid_request_id_is_rejected_before_django_claim(self):
        django = FakeDjangoClient()
        controller = PasswordResetController(django, FakeScanner(), FakeDisplay())

        with self.assertRaises(ValueError):
            controller.accept_handoff('')

        self.assertEqual(django.claimed_request_ids, [])

    def test_mock_nfc_adapter_returns_configured_uid_only_after_simulated_scan(self):
        scanner = MockNFCScanner('NFC-MOCK-001')
        scanner.simulate_scan()

        self.assertEqual(scanner.scan_uid(), 'NFC-MOCK-001')

    def test_mock_display_keeps_reset_code_in_display_state(self):
        display = MockDisplay()
        display.show_message('PASSWORD RECOVERY', 'Tap your registered NFC card.')
        self.assertEqual(display.snapshot()['state'], 'waiting')

        display.show_reset_code('generated-reset-token', 'future')
        snapshot = display.snapshot()
        self.assertEqual(snapshot['state'], 'code')
        self.assertEqual(snapshot['reset_token'], 'generated-reset-token')

        display.clear()
        self.assertEqual(display.snapshot()['state'], 'idle')

    def test_mock_normal_access_and_registration_delegate_to_django(self):
        django = FakeDjangoClient()
        scanner = MockNFCScanner('NFC-MOCK-001')
        controller = PasswordResetController(django, scanner, FakeDisplay())

        self.assertTrue(controller.verify_mock_access()['success'])
        controller.capture_mock_uid()
        result = controller.register_mock_student('Student One', 'STU-001', 'student@example.com', 'CAB-101')

        self.assertEqual(result['student_id'], 'STU-001')
        self.assertEqual(django.registered_students[-1][-1], 'NFC-MOCK-001')

    def test_real_access_scan_reads_from_scanner_then_verifies_uid(self):
        django = FakeDjangoClient()
        controller = PasswordResetController(django, FakeScanner(), FakeDisplay())

        uid = controller.scan_access_card()
        result = controller.verify_access_card(uid)

        self.assertEqual(uid, 'NFC-001')
        self.assertTrue(result['success'])


if __name__ == '__main__':
    unittest.main()
