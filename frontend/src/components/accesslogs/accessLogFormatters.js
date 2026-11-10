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

export const formatAccessLogDuration = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '—'

  const totalSeconds = Math.floor(seconds)
  if (totalSeconds < 60) return `${totalSeconds} sec`

  const totalMinutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (totalMinutes < 60) return `${totalMinutes} min${remainingSeconds ? ` ${remainingSeconds} sec` : ''}`

  const totalHours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60
  if (totalHours < 24) return `${totalHours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ''}`

  const days = Math.floor(totalHours / 24)
  const remainingHours = totalHours % 24
  return `${days} day${days === 1 ? '' : 's'}${remainingHours ? ` ${remainingHours} hr` : ''}${remainingMinutes ? ` ${remainingMinutes} min` : ''}`
}

export const accessLogResult = (log) => {
  const result = String(log?.access_result || log?.status || '').trim().toLowerCase()
  if (!result) return 'Not recorded'
  return result === 'success' ? 'Success' : 'Failed'
}