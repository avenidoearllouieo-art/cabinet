import { HardwareNfcProvider } from './hardwareNfcProvider.js'

export function createNfcProvider({ mode, serviceUrl, fetcher }) {
  if (mode !== 'hardware') {
    throw new Error('Unsupported NFC provider mode. Only hardware mode is supported.')
  }
  if (!serviceUrl) throw new Error('VITE_NFC_SERVICE_URL is required in hardware mode.')
  return new HardwareNfcProvider({ serviceUrl, fetcher })
}
