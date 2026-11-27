"""Backend workflow identity validation; unrelated to ESP32 serial sessions."""
from uuid import UUID, RFC_4122


def canonical_session_uuid(value):
    if not isinstance(value, str) or value != value.strip():
        raise ValueError('A backend session UUID is required.')
    try:
        identity = UUID(value)
    except (ValueError, AttributeError) as error:
        raise ValueError('Invalid backend session UUID.') from error
    if identity.version != 4 or identity.variant != RFC_4122 or str(identity) != value.lower():
        raise ValueError('A canonical UUIDv4 backend session identity is required.')
    return str(identity)
