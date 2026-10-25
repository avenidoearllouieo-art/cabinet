export function motorDispatchStatus(dispatch, expectedAction) {
  if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) {
    return 'Motor dispatch unavailable: the Pi service did not report a result. Workflow completion does not confirm motor transmission or shutter movement.'
  }
  if (dispatch.workflow_action !== expectedAction) {
    return 'Motor dispatch unavailable: the Pi service reported a different workflow action.'
  }
  const outcome = typeof dispatch.outcome === 'string' ? dispatch.outcome : 'unknown'
  const reason = typeof dispatch.error === 'string' && dispatch.error
    ? ` ${dispatch.error}`
    : ''
  const serialConnection = typeof dispatch.serial_connection === 'string'
    ? dispatch.serial_connection
    : null
  const accepted = dispatch.serial_accepted === true
    || (Array.isArray(dispatch.serial_responses)
      && dispatch.serial_responses.some((response) => /,ACCEPTED,/.test(response)))

  if (
    dispatch.outcome === 'completed'
    && dispatch.serial_command_sent === true
    && dispatch.physical_movement_verified === true
  ) {
    return 'Physical cabinet movement was confirmed by the controller feedback.'
  }
  if (dispatch.outcome === 'completed' && dispatch.serial_command_sent === true) {
    return 'ESP32 completed its command sequence; physical shutter movement was not verified.'
  }
  if (dispatch.serial_command_sent === null) {
    return `Motor outcome unknown: the Pi could not determine whether a serial command was sent. Manual inspection is required.${reason}`
  }
  if (dispatch.outcome === 'completed') {
    return 'Motor outcome unknown: the result is inconsistent; serial command completion was not confirmed.'
  }
  if (
    dispatch.outcome === 'rejected'
    && dispatch.serial_command_sent === false
    && /actuation is disabled/i.test(reason)
  ) {
    const connection = serialConnection ? ` Serial connection: ${serialConnection}.` : ''
    const armed = typeof dispatch.controller_armed === 'boolean'
      ? ` Controller ${dispatch.controller_armed ? 'armed' : 'disarmed'}.`
      : ''
    return `Motor dispatch disabled; no serial command was sent.${connection}${armed}${reason}`
  }
  if (dispatch.serial_command_sent === false) {
    if (dispatch.outcome === 'busy') {
      return `Motor controller busy; no serial command was sent.${reason}`
    }
    if (dispatch.controller_armed === false) {
      const connection = serialConnection === 'disconnected'
        ? ' The serial connection is disconnected.'
        : ''
      return `Motor command not sent: the controller is disarmed.${connection} Operator recovery is required before dispatch.${reason}`
    }
    if (serialConnection === 'disconnected') {
      return `Motor command not sent: the serial controller is disconnected.${reason}`
    }
    if (dispatch.outcome === 'uncertain') {
      return `Motor command was not transmitted; controller readiness is unconfirmed.${reason}`
    }
    if (dispatch.outcome === 'rejected' || dispatch.outcome === 'failed' || dispatch.outcome === 'skipped') {
      return `Motor dispatch failed before transmission (${outcome}).${reason}`
    }
    return `Motor command not transmitted (${outcome}).${reason}`
  }
  if (dispatch.outcome === 'busy') {
    return `Motor controller busy; the transmitted command was rejected before execution.${reason}`
  }
  if (dispatch.outcome === 'rejected' || dispatch.outcome === 'failed') {
    return `Motor dispatch failed (${outcome}).${reason}`
  }
  if (accepted) {
    return `ESP32 accepted the command, but completion is unconfirmed. Physical shutter movement was not verified.${reason}`
  }
  if (dispatch.serial_command_sent === true) {
    return `Serial command was transmitted, but ESP32 acceptance and completion are unconfirmed.${reason}`
  }
  if (dispatch.outcome === 'uncertain') {
    return `Motor command was transmitted, but its result is unconfirmed. Manual inspection is required.${reason}`
  }
  return `Motor dispatch status unknown (${outcome}).${reason}`
}
