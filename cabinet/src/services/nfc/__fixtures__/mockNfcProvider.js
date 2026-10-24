export class MockNfcProvider {
  constructor() {
    this.mode = 'mock'
  }

  async submit(uid) {
    const normalizedUid = String(uid || '').trim()
    if (!normalizedUid) throw new Error('Enter an NFC UID to check.')
    return normalizedUid
  }
}
