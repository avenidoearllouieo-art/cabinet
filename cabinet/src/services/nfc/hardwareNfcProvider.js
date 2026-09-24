export class HardwareNfcProvider {
  constructor({ serviceUrl, fetcher, timeoutMs = 5000 }) {
    this.mode = 'hardware'
    this.serviceUrl = serviceUrl.replace(/\/$/, '')
    this.fetcher = fetcher
    this.timeoutMs = timeoutMs
  }

  async poll() {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(`${this.serviceUrl}/nfc/status`, { signal: controller.signal })
      const body = await response.text()
      let data = {}
      try {
        data = body ? JSON.parse(body) : {}
      } catch {
        throw new Error('NFC service returned an invalid response.')
      }
      if (!response.ok) throw new Error(data.error || `NFC service returned HTTP ${response.status}.`)
      return data
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('NFC service request timed out.', { cause: error })
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }
  }
}
