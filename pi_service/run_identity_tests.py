"""Explicit mocked test suite; never discovers the live serial diagnostic."""
import sys
import types
import unittest


def forbid_serial(*args, **kwargs):
    raise AssertionError('Real serial access is prohibited during automated tests.')


if __name__ == '__main__':
    sys.modules['serial'] = types.SimpleNamespace(Serial=forbid_serial)
    suite = unittest.defaultTestLoader.loadTestsFromNames([
        'test_motor_controller', 'test_motor_recovery', 'test_nfc_service',
        'test_bench_open', 'test_password_reset_service', 'test_motor_identity', 'test_motor_connection',
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
