export function getRegistrationValidationError(error) {
  if (error?.response?.status === 410) {
    return 'This registration link has expired or was already used. Tap the NFC card again at the Cabinet to get a fresh link.'
  }

  if (!error?.response) {
    return 'TapTrack could not be reached. Check that the Cabinet and registration service are online, then try again.'
  }

  return `TapTrack could not validate this registration link (HTTP ${error.response.status}). Check the connection and try again.`
}

export function getRegistrationSubmissionError(error) {
  const payload = error?.response?.data
  const fieldError = payload && Object.values(payload)
    .flatMap((messages) => Array.isArray(messages) ? messages : [messages])
    .find((message) => typeof message === 'string' && message.trim())

  return payload?.error
    || payload?.detail
    || fieldError
    || 'Registration could not be completed. Check your details and try again.'
}