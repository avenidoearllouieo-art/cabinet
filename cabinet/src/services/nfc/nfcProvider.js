import { HardwareNfcProvider } from './hardwareNfcProvider'
import { MockNfcProvider } from './mockNfcProvider'

export function createNfcProvider({ mode, serviceUrl, fetcher }) {
  if (mode === 'hardware') {
    if (!serviceUrl) throw new Error('VITE_NFC_SERVICE_URL is required in hardware mode.')
    return new HardwareNfcProvider({ serviceUrl, fetcher })
  }
  return new MockNfcProvider()
}
