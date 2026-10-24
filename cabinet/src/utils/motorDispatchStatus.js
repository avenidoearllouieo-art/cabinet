export function motorDispatchStatus(dispatch, expectedAction) {
  if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) {
    return 'Motor dispatch unavailable: the Pi service did not report a result. Workflow completion does not confirm motor transmission or shutter movement.'
  }
  if (dispatch.workflow_action !== expectedAction) {
    return 'Motor dispatch unavailable: the Pi service reported a different workflow action.'
  }
  if (dispatch.outcome === 'completed' && dispatch.serial_command_sent === true) {
    return 'Motor dispatched: the ESP32 completed its command sequence. Physical shutter position was not verified.'
  }
  const outcome = typeof dispatch.outcome === 'string' ? dispatch.outcome : 'unknown'
  const reason = typeof dispatch.error === 'string' && dispatch.error
    ? ` ${dispatch.error}`
    : ''
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
    return `Motor dispatch disabled.${reason}`
  }
  if (dispatch.outcome === 'uncertain') {
    return `Motor outcome unknown.${reason}`
  }
  if (dispatch.outcome === 'rejected' || dispatch.outcome === 'failed') {
    return `Motor dispatch failed (${outcome}).${reason}`
  }
  if (dispatch.serial_command_sent === false) {
    return `Motor command not transmitted (${outcome}).${reason}`
  }
  return `Motor dispatch status unknown (${outcome}).${reason}`
}
