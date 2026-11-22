export function getPasswordValidationMessage(value) {
  const message = (Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').join(' ')
    : typeof value === 'string' ? value : '').trim()
  const normalized = message.toLowerCase()
  if (!message) return ''
  if (normalized.includes('too similar') && normalized.includes('username')) {
    return 'The password is too similar to your username. Please choose a different password.'
  }
  if (normalized.includes('too similar')) {
    return 'The password is too similar to your account information. Please choose a different password.'
  }
  if (normalized.includes('too common')) return 'This password is too common. Choose a more unique password.'
  if (normalized.includes('entirely numeric')) return 'Your password cannot contain only numbers.'
  if (normalized.includes('too short')) {
    const minimumLength = normalized.match(/at least\s+(\d+)\s+characters/)
    return minimumLength
      ? `Use at least ${minimumLength[1]} characters.`
      : 'Use at least 8 characters.'
  }
  if (normalized.includes('different from your current password')) {
    return "Choose a password you haven't used for this account."
  }
  if (message.length > 240 || /<\/?[a-z!][^>]*>|traceback|stack trace|exception|database|secret|reset_authorization|password hash/i.test(message)) {
    return 'Choose a different password that meets the account security requirements.'
  }
  return message
}