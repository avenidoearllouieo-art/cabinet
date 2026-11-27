import sqlite3
import io
import tempfile
import unittest
from contextlib import closing
from contextlib import redirect_stdout
from unittest.mock import patch
from pathlib import Path
from uuid import uuid4

from motor_controller import MotorOutcome
from motor_identity import canonical_session_uuid
from nfc_service import NFCService, MockNFCReader, SQLiteScanEventStore
from test_nfc_service import FakeMotorController, FakeVerifier


class MotorIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'actions.sqlite3'
        self.store = SQLiteScanEventStore(self.database)
        self.controller = FakeMotorController()
        self.service = NFCService(MockNFCReader(), self.store, FakeVerifier(),
                                  motor_controller=self.controller, motor_actuation_enabled=True)
        self.identity = str(uuid4())

    def tearDown(self):
        self.service.stop()
        self.temp.cleanup()

    def response(self, identity=None, eligible=True, numeric=55):
        return {'station': 'Station 1', 'session': {
            'id': numeric, 'session_uuid': self.identity if identity is None else identity,
            'motor_dispatch_eligible': eligible, 'station': 'Station 1',
            'status': 'open', 'workflow_state': 'idle',
        }}

    def dispatch(self, response=None):
        return self.service.dispatch_motor_transition('finish_open', 'Station 1', 200, response or self.response())

    def legacy(self, status, numeric='55'):
        action = self.store.create_motor_action(numeric, 'Station 1', 'OPEN')
        self.store.claim_motor_action(action['action_id'])
        self.store.finish_motor_action(action['action_id'], status,
            command_transmitted=status != 'FAILED', transaction_id=3,
            error='historical record', command='1')
        return self.store.get_motor_action(action['action_id'])

    def test_same_numeric_id_new_uuids_dispatch_independently(self):
        old = self.legacy('FAILED')
        for identity in (self.identity, str(uuid4())):
            self.assertEqual(self.dispatch(self.response(identity=identity)).outcome, MotorOutcome.COMPLETED)
        self.assertEqual(len(self.controller.calls), 2)
        self.assertEqual(len(self.store.list_motor_actions()), 3)
        self.assertEqual(self.store.get_motor_action(old['action_id']), old)

    def test_same_uuid_different_numeric_id_still_deduplicates(self):
        first = self.dispatch()
        duplicate = self.dispatch(self.response(numeric=999))
        self.assertEqual(first.outcome, MotorOutcome.COMPLETED)
        self.assertEqual(duplicate.outcome, first.outcome)
        self.assertFalse(duplicate.command_transmitted)
        self.assertFalse(duplicate.accepted)
        self.assertIn('Motor dispatch skipped:', duplicate.error)
        self.assertTrue(duplicate.dispatch_skipped)
        self.assertEqual(len(self.controller.calls), 1)

    def test_uuid_case_is_canonicalized_without_duplicate_movement(self):
        self.dispatch()
        self.dispatch(self.response(identity=self.identity.upper()))
        self.assertEqual(len(self.controller.calls), 1)

    def test_missing_malformed_nil_and_non_v4_uuid_fail_closed(self):
        for value in (None, '', 55, True, '55', 'not-a-uuid', '0' * 32,
                      '{' + self.identity + '}', ' ' + self.identity,
                      '00000000-0000-1000-8000-000000000001'):
            response = self.response()
            response['session']['session_uuid'] = value
            with self.subTest(value=value):
                result = self.dispatch(response)
                self.assertEqual(result.outcome, MotorOutcome.REJECTED)
                self.assertFalse(result.command_transmitted)
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(self.store.list_motor_actions(), [])

    def test_old_backend_and_migrated_sessions_never_dispatch(self):
        for status in ('COMPLETED', 'FAILED', 'UNCERTAIN'):
            with self.subTest(status=status):
                old = self.legacy(status, numeric=str(len(self.store.list_motor_actions()) + 47))
                response = self.response(numeric=old['workflow_session'])
                response['session'].pop('session_uuid')
                self.assertFalse(self.dispatch(response).command_transmitted)
                response['session']['session_uuid'] = str(uuid4())
                response['session']['motor_dispatch_eligible'] = False
                result = self.dispatch(response)
                self.assertIn('explicit reconciliation', result.error)
                self.assertEqual(self.store.get_motor_action(old['action_id']), old)
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(len(self.store.list_motor_actions()), 3)

    def test_eligibility_requires_boolean_true_not_a_truthy_value(self):
        for value in (None, False, 'true', 'false', 1, {}):
            self.assertFalse(self.dispatch(self.response(eligible=value)).command_transmitted)
        self.assertEqual(self.controller.calls, [])

    def test_failed_and_uncertain_uuid_actions_are_not_retried(self):
        for outcome in (MotorOutcome.REJECTED, MotorOutcome.UNCERTAIN):
            self.controller.outcome = outcome
            response = self.response(identity=str(uuid4()))
            self.assertEqual(self.dispatch(response).outcome, outcome)
            duplicate = self.dispatch(response)
            self.assertEqual(duplicate.outcome, outcome)
            self.assertFalse(duplicate.command_transmitted)
        self.assertEqual(len(self.controller.calls), 2)

    def test_explicit_reconciliation_links_history_without_replaying_or_rewriting(self):
        for status in ('COMPLETED', 'FAILED', 'UNCERTAIN'):
            old = self.legacy(status, numeric=str(len(self.store.list_motor_actions()) + 55))
            identity = str(uuid4())
            self.store.reconcile_legacy_motor_identity(identity, old['action_id'], 'Human review / ticket 123')
            self.store.reconcile_legacy_motor_identity(identity, old['action_id'], 'Repeat audit')
            result = self.dispatch(self.response(identity=identity))
            self.assertFalse(result.command_transmitted)
            self.assertIn('Motor dispatch skipped:', result.error)
            self.assertEqual(self.store.get_motor_action(old['action_id']), old)
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(len(self.store.list_motor_actions()), 3)

    def test_reconciliation_requires_reference_and_refuses_remapping_or_active_rows(self):
        old = self.legacy('UNCERTAIN')
        with self.assertRaises(ValueError):
            self.store.reconcile_legacy_motor_identity(self.identity, old['action_id'], '')
        self.store.reconcile_legacy_motor_identity(self.identity, old['action_id'], 'Reviewed physical state')
        with self.assertRaises(ValueError):
            self.store.reconcile_legacy_motor_identity(str(uuid4()), old['action_id'], 'Different identity')
        active = self.store.create_motor_action('47', 'Station 2', 'CLOSE')
        with self.assertRaises(ValueError):
            self.store.reconcile_legacy_motor_identity(str(uuid4()), active['action_id'], 'Not safe to remap')

    def test_orphaned_reconciliation_fails_closed(self):
        old = self.legacy('COMPLETED')
        self.store.reconcile_legacy_motor_identity(self.identity, old['action_id'], 'Reviewed')
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('DELETE FROM motor_actions WHERE action_id = ?', (old['action_id'],))
            connection.commit()
        result = self.dispatch()
        self.assertEqual(result.outcome, MotorOutcome.UNCERTAIN)
        self.assertFalse(result.command_transmitted)
        self.assertEqual(self.controller.calls, [])

    def test_existing_uuid_action_cannot_be_replaced_by_a_legacy_link(self):
        self.dispatch()
        old = self.legacy('COMPLETED')
        with self.assertRaises(ValueError):
            self.store.reconcile_legacy_motor_identity(self.identity, old['action_id'], 'Conflicting mapping')
        self.assertEqual(len(self.controller.calls), 1)

    def test_cli_preview_is_read_only_and_apply_requires_explicit_acknowledgement(self):
        from reconcile_motor_identity import main
        old = self.legacy('COMPLETED')
        argv = ['reconcile_motor_identity.py', '--database', str(self.database),
                '--session-uuid', self.identity, '--action-id', old['action_id'],
                '--review-reference', 'Human review']
        with patch('sys.argv', argv), redirect_stdout(io.StringIO()), \
             patch('nfc_service.SQLiteScanEventStore', side_effect=AssertionError('Preview must not initialize a database')):
            main()
        with patch('sys.argv', [*argv, '--apply']), redirect_stdout(io.StringIO()), \
             patch('sys.stderr', new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as refused:
                main()
        self.assertEqual(refused.exception.code, 2)
        self.assertEqual(self.store.get_motor_action(old['action_id']), old)
        self.assertEqual(self.controller.calls, [])


if __name__ == '__main__':
    unittest.main()
