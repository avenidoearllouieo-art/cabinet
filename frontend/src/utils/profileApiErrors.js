function messageText(value) {
  if (Array.isArray(value)) return value.filter((message) => typeof message === 'string').join(' ')
  return typeof value === 'string' ? value : ''
}

function safeFieldMessage(field, value) {
  const message = messageText(value).trim()
  const normalized = message.toLowerCase()
  if (!message) return ''
  if (field === 'credentials' || /credential|cannot be changed through edit profile/.test(normalized)) {
    return 'This field cannot be changed through Edit Profile.'
  }
  if (/already in use|already exists|must be unique|unique constraint/.test(normalized)) {
    return 'This value is already in use.'
  }
  if (field === 'email' && /invalid|valid email/.test(normalized)) {
    return 'Enter a valid email address.'
  }
  if (/required|may not be blank|blank value/.test(normalized)) {
    return 'This field is required.'
  }
  if (message.length > 200 || /<\/?[a-z!][^>]*>|traceback|stack trace|exception|database|sql|password|token|secret/i.test(message)) {
    return 'Could not update this value. Please check it and try again.'
  }
  return message
}

export function getProfileApiErrors(error, editableFields) {
  const data = error.response?.data || {}
  const fieldErrors = {}
  for (const field of editableFields) {
    if (data[field]) fieldErrors[field] = safeFieldMessage(field, data[field])
  }

  if (data.credentials) {
    return { fieldErrors, message: safeFieldMessage('credentials', data.credentials) }
  }
  if (!error.response) return { fieldErrors, message: 'Unable to connect. Please try again.' }
  if (error.response.status === 401) return { fieldErrors, message: 'Your session expired. Sign in and try again.' }
  if (error.response.status === 403) return { fieldErrors, message: 'You do not have permission to update this profile.' }
  if (error.response.status === 409) return { fieldErrors, message: 'Some information is already in use. Review the highlighted fields.' }
  if (error.response.status === 400) return { fieldErrors, message: 'Please review the highlighted fields and try again.' }
  if (error.response.status >= 500) return { fieldErrors, message: 'The service is temporarily unavailable. Please try again later.' }
  return { fieldErrors, message: 'Unable to update profile. Please try again.' }
}