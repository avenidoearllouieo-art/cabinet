export function resolveNfcMode(configuredMode) {
  const mode = String(configuredMode || 'hardware').trim().toLowerCase()
  if (mode !== 'hardware') {
    throw new Error(`Unsupported NFC mode "${mode}". Only hardware mode is supported.`)
  }
  return mode
}