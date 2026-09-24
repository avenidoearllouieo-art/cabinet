import unittest

from nfc_service import MockNFCReader, NFCService, normalize_uid


class NFCServiceTests(unittest.TestCase):
    def test_normalize_uid_is_stable(self):
        self.assertEqual(normalize_uid(' 04 a1-22 '), '04A1-22')

    def test_mock_reader_waits_for_scan_and_removal(self):
        reader = MockNFCReader()
        reader.simulate_scan(' test-nfc-001 ')
        self.assertEqual(reader.wait_for_card(), 'TEST-NFC-001')
        reader.simulate_removal()
        reader.wait_for_removal()

    def test_service_state_uses_event_id_for_each_detected_card(self):
        reader = MockNFCReader()
        service = NFCService(reader, True)
        service.state.card_detected('CARD-A')
        first = service.state.snapshot()
        service.state.card_removed()
        service.state.card_detected('CARD-B')
        second = service.state.snapshot()
        self.assertEqual(first['event_id'], 1)
        self.assertEqual(second['event_id'], 2)
        self.assertEqual(second['uid'], 'CARD-B')


if __name__ == '__main__':
    unittest.main()