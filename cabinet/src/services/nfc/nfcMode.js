export function resolveNfcMode(configuredMode) {
  const mode = String(configuredMode || 'hardware').trim().toLowerCase()
  return mode === 'mock' ? 'mock' : 'hardware'
}