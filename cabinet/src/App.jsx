import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createNfcProvider } from './services/nfc/nfcProvider'
import './App.css'

const PI_SERVICE_URL = import.meta.env.VITE_PI_SERVICE_URL || 'http://127.0.0.1:8765'
const NFC_SERVICE_URL = (import.meta.env.VITE_NFC_SERVICE_URL || '').replace(/\/$/, '')
const NFC_MODE = (import.meta.env.VITE_NFC_MODE || 'mock').toLowerCase()
const NFC_COOLDOWN_MS = Number(import.meta.env.VITE_NFC_COOLDOWN_MS || 2500)
const DJANGO_API_BASE_URL = (import.meta.env.VITE_DJANGO_API_BASE_URL || '/api').replace(/\/$/, '')
const DJANGO_API_KEY = import.meta.env.VITE_DJANGO_API_KEY || ''
const WEB_APP_BASE_URL = (import.meta.env.VITE_WEB_APP_BASE_URL || '').replace(/\/$/, '')
const USE_DJANGO_DEV_PROXY = DJANGO_API_BASE_URL === '/api'
const REQUEST_TIMEOUT_MS = 15000

function buildRegistrationUrl(serverUrl) {
  if (!WEB_APP_BASE_URL) return serverUrl
  try {
    const token = new URL(serverUrl).searchParams.get('token')
    if (!token) return serverUrl
    return `${WEB_APP_BASE_URL}/register?token=${encodeURIComponent(token)}`
  } catch {
    return serverUrl
  }
}

console.info('[Cabinet API diagnostics]', {
  baseUrl: DJANGO_API_BASE_URL,
  keyConfigured: Boolean(DJANGO_API_KEY),
  keyLength: DJANGO_API_KEY.length,
  proxyMode: USE_DJANGO_DEV_PROXY,
  nfcMode: NFC_MODE,
})

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('NFC request timed out. Please try again.', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function readApiResponse(response) {
  const body = await response.text()
  if (!body.trim()) {
    return { data: {}, body: '' }
  }

  try {
    return { data: JSON.parse(body), body }
  } catch {
    return { data: {}, body }
  }
}

function getApiErrorMessage(response, data, body) {
  const detail = data.error || data.detail || data.message
  if (detail) return `${detail} (HTTP ${response.status})`
  if (response.status === 401 || response.status === 403) {
    return `Django rejected the API request. Check VITE_DJANGO_API_KEY. (HTTP ${response.status})`
  }
  if (!body) return `Django returned an empty response. (HTTP ${response.status})`
  return `Django returned an invalid response. (HTTP ${response.status})`
}

function IconNFC({ className = 'icon-lg', pulse = false }) {
  return (
    <svg viewBox="0 0 64 64" className={`${className} ${pulse ? 'pulse' : ''}`} aria-hidden>
      <g fill="none" stroke="#3fd2ff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="14" opacity="0.08" fill="#071826" />
        <path d="M40 32c0-4.4-3.6-8-8-8" />
        <path d="M44 32c0-7-5.4-12.6-12-12.6" />
        <path d="M48 32c0-9.7-7.5-17.6-16.8-17.6" />
      </g>
    </svg>
  )
}

function IconSuccess({ className = 'icon-md' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M20 6L9 17l-5-5" fill="none" stroke="#5ef29b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Screen({ children, className = '' }) {
  return <div className={`screen ${className}`.trim()}>{children}</div>
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function makeSessionId() {
  return `SESSION-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

export default function App() {
  const [view, setView] = useState('home')
  const [pendingAction, setPendingAction] = useState('open')
  const [selectedStation, setSelectedStation] = useState(null)
  const [participants, setParticipants] = useState([])
  const [scanFeedback, setScanFeedback] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Ready for the next cabinet session.')
  const [errorMessage, setErrorMessage] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [form, setForm] = useState({ fullName: '', studentId: '', email: '', section: '' })
  const [nfcUid, setNfcUid] = useState('')
  const [serviceStatus, setServiceStatus] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState({ display: null, error: '', busy: false })
  const [accessState, setAccessState] = useState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
  const [mockNfcUid, setMockNfcUid] = useState('')
  const lastNfcEventRef = useRef(0)
  const verificationInFlightRef = useRef(false)
  const lastProcessedUidRef = useRef('')
  const lastProcessedAtRef = useRef(0)
  const nfcProvider = useMemo(() => {
    try {
      return createNfcProvider({ mode: NFC_MODE, serviceUrl: NFC_SERVICE_URL, fetcher: fetch })
    } catch (error) {
      return { mode: NFC_MODE, poll: async () => { throw error }, submit: async () => { throw error } }
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  const verifyNfcUid = useCallback(async (uid) => {
    if (!uid) {
      setAccessState({ status: 'error', name: '', studentId: '', role: '', message: 'Enter an NFC UID to check.' })
      return
    }

    if (!DJANGO_API_KEY && !USE_DJANGO_DEV_PROXY) {
      setAccessState({ status: 'error', name: '', studentId: '', role: '', message: 'Django API key is not configured. Set VITE_DJANGO_API_KEY and restart Vite.' })
      return
    }

    setAccessState({ status: 'checking', name: '', studentId: '', role: '', message: '' })
    try {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
      if (DJANGO_API_KEY) headers['X-API-Key'] = DJANGO_API_KEY
      console.info('[Cabinet NFC request diagnostics]', {
        endpoint: `${DJANGO_API_BASE_URL}/verify-nfc/`,
        keyConfigured: Boolean(DJANGO_API_KEY),
        keyLength: DJANGO_API_KEY.length,
        xApiKeyHeaderSent: Boolean(headers['X-API-Key']),
      })
      const response = await fetchWithTimeout(`${DJANGO_API_BASE_URL}/verify-nfc/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ nfc_uid: uid }),
      })
      const { data, body } = await readApiResponse(response)
      if (response.ok && data.success) {
        setAccessState({ status: 'success', name: data.name || 'Student', studentId: data.student_id || '', role: data.role || '', message: '' })
        return
      }
      if (response.status === 404) {
        if (data.registration_required && data.registration_url) {
          setAccessState({ status: 'registration', name: '', studentId: '', role: '', message: 'Please scan this QR code to register your card.', registrationUrl: buildRegistrationUrl(data.registration_url) })
        } else {
          setAccessState({ status: 'unregistered', name: '', studentId: '', role: '', message: 'NFC card is not registered yet.', registrationUrl: '' })
        }
        return
      }
      throw new Error(getApiErrorMessage(response, data, body))
    } catch (error) {
      const message = error instanceof TypeError
        ? 'Unable to connect to the Django API. Check that Django is running and VITE_DJANGO_API_BASE_URL is correct.'
        : error.message || 'Django API is unavailable.'
      setAccessState({ status: 'error', name: '', studentId: '', role: '', message })
    }
  }, [])

  async function handleMockNfcSubmit(event) {
    event.preventDefault()
    try {
      const uid = await nfcProvider.submit(mockNfcUid)
      await verifyNfcUid(uid)
    } catch (error) {
      setAccessState({ status: 'error', name: '', studentId: '', role: '', message: error.message || 'Mock NFC input failed.' })
    }
  }

  useEffect(() => {
    if (view !== 'home' || NFC_MODE !== 'hardware') return undefined

    let cancelled = false
    const pollNfcService = async () => {
      try {
        const data = await nfcProvider.poll()
        if (cancelled) return

        if (data.state === 'error') {
          setAccessState((current) => current.status === 'checking'
            ? current
            : { status: 'error', name: '', studentId: '', role: '', message: `NFC reader unavailable. ${data.error || 'Check the NFC service.'}` })
          return
        }

        if (data.state === 'waiting') {
          setAccessState((current) => current.status === 'error'
            ? { status: 'idle', name: '', studentId: '', role: '', message: '' }
            : current)
        }

        const now = Date.now()
        const isCoolingDown = data.uid === lastProcessedUidRef.current && now - lastProcessedAtRef.current < NFC_COOLDOWN_MS
        if (data.state === 'detected' && data.uid && data.event_id !== lastNfcEventRef.current && !isCoolingDown && !verificationInFlightRef.current) {
          lastNfcEventRef.current = data.event_id
          lastProcessedUidRef.current = data.uid
          lastProcessedAtRef.current = now
          verificationInFlightRef.current = true
          setAccessState({ status: 'detected', name: '', studentId: '', role: '', message: 'NFC card detected.' })
          try {
            await verifyNfcUid(data.uid)
          } finally {
            verificationInFlightRef.current = false
          }
        }
      } catch (error) {
        if (!cancelled) setAccessState({ status: 'error', name: '', studentId: '', role: '', message: 'NFC reader unavailable. Check that the NFC service is running.' })
      }
    }

    pollNfcService()
    const intervalId = window.setInterval(pollNfcService, 500)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [nfcProvider, view, verifyNfcUid])

  useEffect(() => {
    if (view !== 'status-screen') return undefined
    let cancelled = false
    fetch(`${PI_SERVICE_URL}/status`)
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Service unavailable.')
        if (!cancelled) setServiceStatus(data)
      })
      .catch(() => {
        if (!cancelled) setServiceStatus({ mode: 'unavailable', physical_hardware: 'not connected', cabinet_actions: 'mock only' })
      })
    return () => { cancelled = true }
  }, [view])

  const occupiedStations = useMemo(() => {
    return sessions
      .filter((session) => session.status === 'open')
      .map((session) => session.station)
  }, [sessions])

  function resetToHome() {
    setView('home')
    setPendingAction('open')
    setSelectedStation(null)
    setParticipants([])
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage('Ready for the next cabinet session.')
    setNfcUid('')
  }

  function startCloseSession() {
    if (!activeSession) {
      setErrorMessage('There is no active cabinet session to close.')
      return
    }

    setPendingAction('close')
    setParticipants([])
    setSelectedStation(activeSession.station)
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage('Scan the returning participants before confirming the closeout.')
    setView('participant-scan')
  }

  function handleStationSelect(station) {
    if (pendingAction === 'open' && occupiedStations.includes(station)) {
      setErrorMessage('That station is already occupied.')
      return
    }

    setSelectedStation(station)
    setErrorMessage('')
    setStatusMessage(pendingAction === 'open'
      ? 'Tap a registered card to add the next participant.'
      : 'Scan each returning participant before closing the cabinet.')
    setView('participant-scan')
  }

  async function handleCardScan() {
    setErrorMessage('')
    setStatusMessage('Waiting for the mock NFC service to verify the card...')

    try {
      const response = await fetch(`${PI_SERVICE_URL}/cabinet/mock-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'NFC verification failed.')
      }

      const nextUid = data.student_id || data.name
      const normalizedUser = {
        uid: nextUid,
        fullName: data.name || 'Verified student',
        studentId: data.student_id || 'Student ID unavailable',
        section: '',
      }
      const alreadyAdded = participants.some((participant) => participant.uid === nextUid)
    if (alreadyAdded) {
      setScanFeedback({ type: 'duplicate', message: 'Duplicate scan detected', participant: normalizedUser })
      setErrorMessage('')
      setStatusMessage('This card was already scanned.')
      return
    }

    const newParticipant = {
      uid: nextUid,
      fullName: normalizedUser.fullName,
      studentId: normalizedUser.studentId,
      section: normalizedUser.section,
    }

    setParticipants((current) => [...current, newParticipant])
    setScanFeedback({ type: 'success', message: 'Participant added', participant: newParticipant })
    setErrorMessage('')
    setStatusMessage('Participant added successfully.')
    } catch (error) {
      setErrorMessage(error.message || 'NFC verification failed. Please try again.')
      setScanFeedback({ type: 'warning', message: 'NFC verification failed', participant: null })
      setStatusMessage('The mock NFC service could not verify the card.')
    }
  }

  function continueToConfirmation() {
    if (participants.length === 0) {
      setErrorMessage('Scan at least one participant before continuing.')
      return
    }

    setErrorMessage('')
    setView('confirm-session')
  }

  function finalizeSession() {
    const now = new Date()
    const snapshot = participants.map((participant) => ({
      uid: participant.uid,
      fullName: participant.fullName,
      studentId: participant.studentId,
      section: participant.section,
    }))

    if (pendingAction === 'open') {
      const sessionRecord = {
        id: makeSessionId(),
        station: selectedStation,
        status: 'open',
        action: 'open',
        timestamp: now.toISOString(),
        participantIds: snapshot.map((participant) => participant.uid),
        participants: snapshot,
      }

      setSessions((current) => [sessionRecord, ...current])
      setActiveSession(sessionRecord)
      setStatusMessage(`Cabinet opened on Station ${selectedStation}.`)
      setView('cabinet-opened')
      return
    }

    if (!activeSession) {
      setErrorMessage('No active session is available to close.')
      return
    }

    const closedSession = {
      ...activeSession,
      status: 'closed',
      closedAt: now.toISOString(),
      closingParticipants: snapshot,
      participantIds: Array.from(new Set([...activeSession.participantIds, ...snapshot.map((participant) => participant.uid)])),
    }

    setSessions((current) => current.map((session) => (session.id === activeSession.id ? closedSession : session)))
    setActiveSession(closedSession)
    setStatusMessage(`Cabinet closed on Station ${selectedStation}.`)
    setView('cabinet-closed')
  }

  async function handleRegistrationSubmit(event) {
    event.preventDefault()

    if (!nfcUid) {
      setErrorMessage('A tapped card is required before registration can proceed.')
      return
    }

    if (!form.fullName.trim() || !form.studentId.trim() || !form.section.trim()) {
      setErrorMessage('Please complete all registration fields.')
      return
    }

    if (!form.email.trim()) {
      setErrorMessage('Please enter an email address for the Django account.')
      return
    }

    try {
      const response = await fetch(`${PI_SERVICE_URL}/cabinet/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.fullName.trim(),
          student_id: form.studentId.trim(),
          email: form.email.trim(),
          section: form.section.trim(),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Card registration could not be completed.')
      setStatusMessage('Card registered in Django successfully.')
      setErrorMessage('')
      setView('registration-success')
    } catch (error) {
      setErrorMessage(error.message || 'The mock Pi service is unavailable.')
    }
  }

  async function captureMockCard() {
    try {
      const response = await fetch(`${PI_SERVICE_URL}/cabinet/mock-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('The mock NFC service is unavailable.')
      setNfcUid('captured by mock Pi service')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message || 'The mock NFC service is unavailable.')
    }
  }

  function startPasswordRecovery() {
    setPasswordRecovery({ display: null, error: '', busy: false })
    setView('password-recovery')
  }

  async function sendMockRecoveryScan() {
    setPasswordRecovery((current) => ({ ...current, busy: true, error: '' }))
    try {
      const response = await fetch(`${PI_SERVICE_URL}/password-reset/mock-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Mock NFC scan was rejected.')
    } catch {
      setPasswordRecovery((current) => ({ ...current, busy: false, error: 'NFC verification failed. Make sure the mock Pi service has an active reset request.' }))
    }
  }

  async function retryPasswordRecovery() {
    setPasswordRecovery((current) => ({ ...current, busy: true, error: '' }))
    try {
      const response = await fetch(`${PI_SERVICE_URL}/password-reset/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Recovery retry was rejected.')
    } catch {
      setPasswordRecovery((current) => ({ ...current, busy: false, error: 'The recovery service is unavailable. Please start a new reset request.' }))
    }
  }

  async function finishPasswordRecovery() {
    try {
      await fetch(`${PI_SERVICE_URL}/password-reset/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    } catch {
      // Returning home is still safe; the short-lived display state remains local to the mock service.
    }
    setPasswordRecovery({ display: null, error: '', busy: false })
    resetToHome()
  }

  useEffect(() => {
    if (view !== 'password-recovery') return undefined

    let cancelled = false
    const pollDisplay = async () => {
      try {
        const response = await fetch(`${PI_SERVICE_URL}/password-reset/display`)
        if (!response.ok) throw new Error('Display state unavailable.')
        const display = await response.json()
        if (!cancelled) setPasswordRecovery((current) => ({ ...current, display, busy: false }))
      } catch {
        if (!cancelled) setPasswordRecovery((current) => ({ ...current, error: 'The mock Pi service is unavailable. Start it before scanning.', busy: false }))
      }
    }

    pollDisplay()
    const intervalId = window.setInterval(pollDisplay, 700)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [view])

  return (
    <div className="app-root">
      {view === 'home' && (
        <Screen>
          <div className="home-shell">
            <div className="hero-card">
              <div className="nfc-ring">
                <IconNFC pulse={accessState.status === 'idle'} />
              </div>
              <div className="title-block">
                <h1 className="title">
                  {accessState.status === 'registration' ? 'NFC card not registered.' : accessState.status === 'detected' ? 'NFC detected' : accessState.status === 'checking' ? 'Checking NFC...' : accessState.status === 'success' ? `Welcome, ${accessState.name}` : accessState.status === 'unregistered' ? 'NFC card not registered' : accessState.status === 'error' ? 'NFC API error' : 'Waiting for NFC'}
                </h1>
                <p className="subtitle">
                  {accessState.status === 'success' ? 'Your card was recognized.' : accessState.status === 'registration' ? accessState.message : accessState.status === 'detected' ? accessState.message : accessState.status === 'unregistered' || accessState.status === 'error' ? accessState.message : accessState.status === 'checking' ? 'Please wait while Django checks the card.' : 'Enter a mock UID below to check a card.'}
                </p>
                {accessState.status === 'registration' && accessState.registrationUrl && (
                  <div className="registration-qr">
                    <QRCodeSVG value={accessState.registrationUrl} size={240} bgColor="#ffffff" fgColor="#071826" level="M" />
                  </div>
                )}
                {accessState.status === 'success' && (
                  <div className="student-readout">
                    <strong>{accessState.name}</strong>
                    {accessState.studentId && <span>Student ID: {accessState.studentId}</span>}
                    {accessState.role && <span>Role: {accessState.role}</span>}
                  </div>
                )}
              </div>
              {accessState.status === 'success' && <div className="status-chip"><span className="status-dot good" /><span>Access verified</span></div>}
              <div className="clock-card">
                <span className="clock-label">Cabinet Status</span>
                <strong>{accessState.status === 'detected' || accessState.status === 'checking' ? 'Checking card' : 'Ready for NFC'}</strong>
                <span className="clock-time">{formatDateTime(clock)}</span>
              </div>
            </div>

            {NFC_MODE === 'mock' && (
              <form className="mock-nfc-form" onSubmit={handleMockNfcSubmit}>
                <label htmlFor="mock-nfc-uid">Mock NFC UID</label>
                <div className="mock-nfc-controls">
                  <input
                    id="mock-nfc-uid"
                    value={mockNfcUid}
                    onChange={(event) => setMockNfcUid(event.target.value)}
                    placeholder="Enter NFC UID"
                    autoComplete="off"
                  />
                  <button className="btn primary" type="submit" disabled={accessState.status === 'checking'}>
                    Check NFC
                  </button>
                </div>
              </form>
            )}

            <div className="home-actions">
              <button className="btn ghost home-action" onClick={() => setView('status-screen')}>Cabinet Status</button>
              <button className="btn ghost home-action" onClick={startPasswordRecovery}>Password Recovery</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'password-recovery' && (
        <Screen>
          <div className="panel recovery-panel">
            {passwordRecovery.display?.state === 'code' ? (
              <>
                <div className="success-badge"><IconSuccess className="icon-md" /></div>
                <h2>PASSWORD RESET CODE</h2>
                <p className="muted">Your one-time reset code:</p>
                <div className="recovery-token" aria-label="One-time reset code">{passwordRecovery.display.reset_token}</div>
                <p className="muted">Enter this code on the Password Recovery page.<br />This code expires soon.</p>
                <div className="button-row"><button className="btn primary" onClick={finishPasswordRecovery}>Done</button></div>
              </>
            ) : (
              <>
                <div className="nfc-ring small-ring"><IconNFC pulse /></div>
                <h2>PASSWORD RECOVERY</h2>
                <p className="muted">Please tap your registered NFC card<br />to verify your identity.</p>
                {passwordRecovery.display?.state === 'error' && <div className="error-banner">{passwordRecovery.display.message}</div>}
                {passwordRecovery.error && <div className="error-banner">{passwordRecovery.error}</div>}
                <div className="button-row stacked">
                  <button className="btn primary scan-action" onClick={sendMockRecoveryScan} disabled={passwordRecovery.busy}>Tap NFC Card</button>
                  {(passwordRecovery.display?.state === 'error' || passwordRecovery.error) && <button className="btn secondary" onClick={retryPasswordRecovery} disabled={passwordRecovery.busy}>Try Again</button>}
                  <button className="btn ghost" onClick={finishPasswordRecovery} disabled={passwordRecovery.busy}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </Screen>
      )}

      {view === 'register-card' && (
        <Screen>
          <div className="panel form-panel">
            <h2>Register Card</h2>
            <p className="muted">Capture a mock card and save the student account through Django.</p>
            <div className="uid-readout uid-readonly">
              <span className="uid-label">Captured NFC UID</span>
              <strong>{nfcUid || 'Tap a card to capture a UID'}</strong>
            </div>
            <form className="form-grid" onSubmit={handleRegistrationSubmit}>
              <label className="field">
                <span>Full Name</span>
                <input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Enter full name" />
              </label>
              <label className="field">
                <span>Student ID</span>
                <input value={form.studentId} onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))} placeholder="Enter student ID" />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Enter account email" />
              </label>
              <label className="field">
                <span>Section</span>
                <input value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} placeholder="Enter section" />
              </label>
              {errorMessage && <div className="error-banner">{errorMessage}</div>}
              <div className="button-row">
                <button className="btn primary" type="button" onClick={captureMockCard}>Capture Card</button>
                <button className="btn primary" type="submit" disabled={!nfcUid}>Save Card</button>
              </div>
              <button className="btn ghost" type="button" onClick={resetToHome}>Back</button>
            </form>
          </div>
        </Screen>
      )}

      {view === 'registration-success' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="success-badge">
              <IconSuccess className="icon-md" />
            </div>
            <h2>Card Registered</h2>
            <p className="muted">The new student profile is ready for the next NFC scan.</p>
            <div className="button-row">
              <button className="btn primary" onClick={resetToHome}>Back to Home</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'station-select' && (
        <Screen>
          <div className="panel">
            <h2>Select a Station</h2>
            <p className="muted">Choose the cabinet station for this session.</p>
            <div className="station-grid">
              {[1, 2].map((station) => (
                <button
                  key={station}
                  className="btn station-button"
                  onClick={() => handleStationSelect(station)}
                >
                  <span>Station {station}</span>
                  <small>{occupiedStations.includes(station) ? 'Occupied' : 'Available'}</small>
                </button>
              ))}
            </div>
            {errorMessage && <div className="error-banner">{errorMessage}</div>}
            <div className="button-row">
              <button className="btn ghost" onClick={resetToHome}>Cancel</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'participant-scan' && (
        <Screen>
          <div className="participant-shell">
            <div className="scan-hero">
              <div className="nfc-ring small-ring">
                <IconNFC pulse />
              </div>
              <h2>{pendingAction === 'open' ? 'Open Cabinet' : 'Close Cabinet'}</h2>
              <p className="muted">{selectedStation ? `Station ${selectedStation}` : 'Choose a station'}</p>
            </div>

            <div className="status-chip">
              <span className={`status-dot ${scanFeedback?.type === 'success' ? 'good' : scanFeedback?.type === 'duplicate' ? 'warning-dot' : 'good'}`} />
              <span>{statusMessage}</span>
            </div>

            <div className="feedback-card">
              {scanFeedback?.type === 'success' && (
                <div className="feedback-banner success">
                  <span className="feedback-check">✓</span>
                  <div>
                    <strong>{scanFeedback.participant?.fullName}</strong>
                    <p>{scanFeedback.participant?.studentId}</p>
                  </div>
                </div>
              )}
              {scanFeedback?.type === 'duplicate' && (
                <div className="feedback-banner duplicate">
                  <span className="feedback-check">!</span>
                  <div>
                    <strong>Duplicate scan</strong>
                    <p>{scanFeedback.participant?.fullName || 'That card has already been recorded.'}</p>
                  </div>
                </div>
              )}
              {scanFeedback?.type === 'warning' && (
                <div className="feedback-banner warning">
                  <span className="feedback-check">!</span>
                  <div>
                    <strong>{scanFeedback.message}</strong>
                    <p>Try another registered card.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Current Participants</h3>
                <span>{participants.length} scanned</span>
              </div>
              <div className="participant-list">
                {participants.length === 0 ? (
                  <div className="empty-state">No participants scanned yet. Tap the button below to add one.</div>
                ) : (
                  participants.map((participant, index) => (
                    <div key={`${participant.uid}-${index}`} className="participant-card pop-pill">
                      <div className="participant-badge">✓</div>
                      <div>
                        <strong>{participant.fullName}</strong>
                        <p>{participant.studentId}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="button-row stacked">
              <button className="btn primary scan-action" onClick={() => handleCardScan()}>Tap another NFC card…</button>
              <div className="button-row inline">
                <button className="btn secondary" onClick={continueToConfirmation}>Done</button>
                <button className="btn ghost" onClick={resetToHome}>Cancel Session</button>
              </div>
            </div>
          </div>
        </Screen>
      )}

      {view === 'confirm-session' && (
        <Screen>
          <div className="panel confirm-panel">
            <h2>{pendingAction === 'open' ? 'Confirm Open Cabinet' : 'Confirm Close Cabinet'}</h2>
            <p className="muted">Review the scanned participants and the selected station before you proceed.</p>
            <div className="confirm-list">
              <div className="confirm-row">
                <span>Station</span>
                <strong>{selectedStation}</strong>
              </div>
              <div className="confirm-row">
                <span>Participants</span>
                <strong>{participants.length}</strong>
              </div>
              <div className="confirm-row">
                <span>Scanned list</span>
                <strong>{participants.map((participant) => participant.fullName).join(', ')}</strong>
              </div>
            </div>
            <div className="participant-list">
              {participants.map((participant, index) => (
                <div key={`${participant.uid}-${index}`} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div>
                    <strong>{participant.fullName}</strong>
                    <p>{participant.studentId}</p>
                  </div>
                </div>
              ))}
            </div>
            {errorMessage && <div className="error-banner">{errorMessage}</div>}
            <div className="button-row">
              <button className="btn ghost" onClick={() => setView('participant-scan')}>Back</button>
              <button className="btn primary" onClick={finalizeSession}>{pendingAction === 'open' ? 'Open Cabinet' : 'Confirm Close Cabinet'}</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-opened' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="success-badge">
              <IconSuccess className="icon-md" />
            </div>
            <h2>Cabinet Opened</h2>
            <p className="muted">The cabinet is open and one session was saved with all scanned participants.</p>
            <div className="status-chip">
              <span className="status-dot good" />
              <span>Session {activeSession?.id || 'saved'}</span>
            </div>
            <div className="button-row stacked">
              <button className="btn primary" onClick={startCloseSession}>Close Cabinet</button>
              <button className="btn ghost" onClick={resetToHome}>Back to Home</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-closed' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="success-badge">
              <IconSuccess className="icon-md" />
            </div>
            <h2>Cabinet Closed</h2>
            <p className="muted">The closing timestamp and returning participant list were saved.</p>
            <div className="button-row">
              <button className="btn primary" onClick={resetToHome}>Done</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'status-screen' && (
        <Screen>
          <div className="panel">
            <h2>Cabinet Status</h2>
            <p className="muted">Development service status and local mock session activity.</p>
            {serviceStatus && (
              <div className="status-card">
                <strong>Mock Pi service: {serviceStatus.mode}</strong>
                <p>Django API: {serviceStatus.django_api || 'unavailable'}</p>
                <small>Physical hardware: {serviceStatus.physical_hardware || 'not connected'} · Cabinet actions: {serviceStatus.cabinet_actions || 'mock only'}</small>
              </div>
            )}
            <div className="status-list">
              {sessions.length === 0 ? (
                <div className="empty-state">No sessions recorded yet.</div>
              ) : (
                sessions.slice(0, 4).map((session) => (
                  <div key={session.id} className="status-card">
                    <strong>{session.id}</strong>
                    <p>Station {session.station} · {session.status}</p>
                    <small>{session.timestamp ? formatDateTime(new Date(session.timestamp)) : 'Saved'}</small>
                  </div>
                ))
              )}
            </div>
            <div className="button-row">
              <button className="btn ghost" onClick={resetToHome}>Back</button>
            </div>
          </div>
        </Screen>
      )}
    </div>
  )
}
