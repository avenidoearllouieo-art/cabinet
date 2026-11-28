export function textValue(value, fallback = 'Not recorded') {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback
  return value
}

export function formatName(firstName, lastName, fallback = 'Name unavailable') {
  const name = [firstName, lastName].filter((value) => typeof value === 'string' && value.trim()).join(' ').trim()
  return name || fallback
}

export function formatDateValue(value, fallback = 'No date recorded') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? fallback
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatCount(value, fallback = 'Unavailable') {
  if (value === null || value === undefined) return fallback
  return Number(value)
}
