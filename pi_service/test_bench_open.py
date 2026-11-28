import unittest
from unittest.mock import patch

import bench_open
from motor_controller import MotorOutcome


class BenchOpenTests(unittest.TestCase):
    @patch.object(bench_open, 'create_serial_motor_controller')
    def test_cancel_before_recovery_never_opens_serial(self, factory):
        with patch.object(bench_open, 'confirm', side_effect=[True, False]):
            self.assertEqual(bench_open.run_bench('Station 1'), 1)
        factory.assert_not_called()

    @patch.object(bench_open, 'create_serial_motor_controller')
    def test_failed_recovery_never_starts_or_sends(self, factory):
        controller = factory.return_value
        controller.recover.return_value = False
        with patch.object(bench_open, 'confirm', side_effect=[True, True]):
            self.assertEqual(bench_open.run_bench('Station 2'), 1)
        controller.start.assert_not_called()
        controller.command.assert_not_called()
        controller.close.assert_called_once()

    @patch.object(bench_open, 'create_serial_motor_controller')
    def test_cancel_after_recovery_never_sends(self, factory):
        with patch.object(bench_open, 'confirm', side_effect=[True, True, False]):
            self.assertEqual(bench_open.run_bench('Station 1'), 1)
        factory.return_value.command.assert_not_called()
        factory.return_value.close.assert_called_once()

    @patch.object(bench_open, 'create_serial_motor_controller')
    def test_uncertain_result_is_never_retried(self, factory):
        controller = factory.return_value
        controller.command.return_value.outcome = MotorOutcome.UNCERTAIN
        with patch.object(bench_open, 'confirm', side_effect=[True, True, True]):
            self.assertEqual(bench_open.run_bench('Station 2'), 1)
        controller.command.assert_called_once_with('Station 2', 'OPEN')
        controller.close.assert_called_once()
