import { HardwareNfcProvider } from './hardwareNfcProvider.js'
import { MockNfcProvider } from './mockNfcProvider.js'

export function createNfcProvider({ mode, serviceUrl, fetcher }) {
  if (mode === 'mock') return new MockNfcProvider()
  if (mode === 'hardware') {
    if (!serviceUrl) throw new Error('VITE_NFC_SERVICE_URL is required in hardware mode.')
    return new HardwareNfcProvider({ serviceUrl, fetcher })
  }
  throw new Error('NFC mode must be explicitly set to hardware or mock.')
}
