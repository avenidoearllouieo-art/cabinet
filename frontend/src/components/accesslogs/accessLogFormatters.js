export const accessLogValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return 'Not recorded'
  return String(value)
}

const parseAccessTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatAccessLogDate = (value) => {
  const date = parseAccessTime(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
    : 'Not recorded'
}

export const formatAccessLogTime = (value) => {
  const date = parseAccessTime(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
    : 'Not recorded'
}

export const accessLogResult = (log) => {
  const result = String(log?.access_result || log?.status || '').trim().toLowerCase()
  if (!result) return 'Not recorded'
  return result === 'success' ? 'Success' : 'Failed'
}