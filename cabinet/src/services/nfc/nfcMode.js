export function resolveNfcMode(configuredMode, isDevelopment = false) {
  const mode = String(configuredMode || 'hardware').trim().toLowerCase()
  return isDevelopment && mode === 'mock' ? 'mock' : 'hardware'
}