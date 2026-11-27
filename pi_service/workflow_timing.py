"""Convert trusted, same-host Nginx timestamps into a local monotonic deadline."""

import re
import time


WORKFLOW_DISPATCH_SECONDS = 10.0
INGRESS_AGE_HEADER = 'X-TapTrack-Ingress-Age'
INGRESS_FORWARDED_AT_HEADER = 'X-TapTrack-Ingress-Forwarded-At'
WORKFLOW_EXPIRED_CODE = 'WORKFLOW_EXPIRED_BEFORE_DISPATCH'
MAX_CLOCK_SHIFT_SECONDS = 0.25
MAX_CLOCK_SAMPLE_SECONDS = 0.05
# Cover two clock deviations, Nginx millisecond rounding and sampling error.
CLOCK_GUARD_SECONDS = 0.56
SECONDS = re.compile(r'[0-9]{1,12}\.[0-9]{3}')


class IngressTimingError(ValueError):
    pass


class IngressExpired(TimeoutError):
    pass


def _read_seconds(headers, name: str) -> float:
    values = headers.get_all(name, [])
    if len(values) != 1 or not SECONDS.fullmatch(values[0]):
        raise IngressTimingError('Missing or malformed workflow timing.')
    return float(values[0])


class WorkflowIngressClock:
    def __init__(self):
        self._monotonic_start = time.monotonic()
        self._wall_start = time.time()
        self._clock_fault = time.monotonic() - self._monotonic_start > MAX_CLOCK_SAMPLE_SECONDS

    def deadline(self, headers) -> float:
        # Only call after validating the loopback proxy's independent credential.
        age = _read_seconds(headers, INGRESS_AGE_HEADER)
        forwarded_at = _read_seconds(headers, INGRESS_FORWARDED_AT_HEADER)
        monotonic_now = time.monotonic()
        wall_now = time.time()
        if self._clock_fault or time.monotonic() - monotonic_now > MAX_CLOCK_SAMPLE_SECONDS:
            raise IngressTimingError('Workflow clock is unavailable.')
        wall_shift = (wall_now - self._wall_start) - (monotonic_now - self._monotonic_start)
        if abs(wall_shift) > MAX_CLOCK_SHIFT_SECONDS:
            self._clock_fault = True
            raise IngressTimingError('Workflow clock changed. Operator verification and restart required.')

        transit = wall_now - forwarded_at
        if forwarded_at < 1_500_000_000 or age >= forwarded_at or transit < -MAX_CLOCK_SHIFT_SECONDS:
            raise IngressTimingError('Implausible workflow proxy timing.')
        elapsed = age + max(0.0, transit) + CLOCK_GUARD_SECONDS
        remaining = WORKFLOW_DISPATCH_SECONDS - elapsed
        if remaining <= 0:
            raise IngressExpired('Workflow expired before dispatch.')
        return monotonic_now + remaining
