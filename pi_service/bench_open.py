"""Local, interactive, one-shot OPEN for an independently stopped unloaded bench."""

import argparse
import select
import subprocess
import sys

from motor_controller import MotorOutcome
from nfc_service import create_serial_motor_controller


def confirm(prompt, phrase, *, timeout=None):
    print(prompt, flush=True)
    print(f'Type {phrase} to confirm, or press Enter to cancel: ', end='', flush=True)
    if timeout is not None and not select.select([sys.stdin], [], [], timeout)[0]:
        return False
    return sys.stdin.readline().rstrip('\r\n') == phrase


def run_bench(station):
    if not confirm(
        'Verify unloaded, secured motors, working OPEN limits and GPIO stop, verified 200-pulse firmware, '
        'and an operator-tested independent driver power stop. Keep driver power isolated.',
        'BENCH VERIFIED',
    ):
        return 1
    if not confirm('Verify stationary motors, driver power isolated, and a fresh ESP32 power cycle.', 'RECOVERY VERIFIED'):
        return 1

    controller = create_serial_motor_controller()
    try:
        if not controller.recover(
            operator_confirmed_driver_power_isolated=True,
            operator_confirmed_stationary=True,
            operator_confirmed_esp32_power_cycled=True,
        ):
            print('Recovery refused. Keep driver power isolated.')
            return 1

        # The worker maintains communication only. It cannot arm or send OPEN.
        controller.start()
        if not confirm(
            f'Only after recovery, the responsible operator may energize the unloaded bench. '
            f'Keep the independent stop within reach. Send one OPEN for {station}.',
            'ONE OPEN', timeout=30,
        ):
            return 1
        result = controller.command(station, 'OPEN')
        print(f'Controller result: {result.outcome.value}.')
        if result.error:
            print(result.error)
        return 0 if result.outcome is MotorOutcome.COMPLETED else 1
    finally:
        print('Isolate driver power before leaving the bench. Review any uncertain result before another run.', flush=True)
        controller.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('station', choices=['Station 1', 'Station 2'])
    args = parser.parse_args()
    if sys.platform != 'linux' or not sys.stdin.isatty():
        parser.error('An interactive Linux console is required.')
    active = subprocess.run(
        ['systemctl', 'show', '--property=ActiveState', '--value', 'taptrack-nfc.service'],
        check=True, capture_output=True, text=True, timeout=5,
    ).stdout.strip()
    if active != 'inactive':
        parser.error('The NFC service must be stopped before opening the serial device.')
    try:
        return run_bench(args.station)
    except (KeyboardInterrupt, EOFError):
        return 1


if __name__ == '__main__':
    sys.exit(main())
