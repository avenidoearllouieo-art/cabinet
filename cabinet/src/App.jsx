import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import AccessPhotoDetails from './components/AccessPhotoDetails'
import { isSessionMember, recordClosingAttendance } from './services/cabinetAttendance'
import { fetchAccessLogPhoto, getDjangoAccessLogEventId } from './services/accessLogPhoto'
import { captureAccessLogPhoto, fetchCabinetWorkflow, fetchNfcServiceStatus, fetchScanEvents, sendCabinetWorkflow } from './services/nfc/scanResultBridge'
import './App.css'

const NFC_SCAN_CURSOR_KEY = 'taptrack_cabinet_nfc_scan_cursor'
const PHOTO_STATUS_ATTEMPTS = 12
const PHOTO_STATUS_RETRY_DELAY_MS = 750

function IconNFC({ className = 'icon-lg', pulse = false }) {
  return (
    <svg viewBox="0 0 64 64" className={`${className} ${pulse ? 'pulse' : ''}`} aria-hidden>
      <g fill="none" stroke="#002B5B" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="14" opacity="0.08" fill="#002B5B" />
        <path d="M40 32c0-4.4-3.6-8-8-8" />
        <path d="M44 32c0-7-5.4-12.6-12-12.6" />
        <path d="M48 32c0-9.7-7.5-17.6-16.8-17.6" />
      </g>
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

function formatSessionTime(date) {
  if (!date) return 'Unavailable'
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(date))
}

function getParticipantCount(session) {
  return session?.opened_by?.length || session?.openedByStudentIds?.length || session?.openedByUids?.length || 0
}

function loadNfcScanCursor() {
  try {
    const cursor = Number.parseInt(localStorage.getItem(NFC_SCAN_CURSOR_KEY) || '0', 10)
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
  } catch {
    return 0
  }
}

function normalizeServerSession(session) {
  if (!session) return null
  const openedBy = session.opened_by || []
  const closedBy = session.closed_by || []
  return {
    ...session,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openedByStudentIds: openedBy.map((student) => student.studentId),
    openedByUids: openedBy.map((student) => student.uid),
    closedBy,
    closedByStudentIds: closedBy.map((student) => student.studentId),
    closedByUids: closedBy.map((student) => student.uid),
  }
}

function stationLabel(station) {
  const value = String(station || '').trim()
  if (!value) return 'Station unavailable'
  return /^station\s/i.test(value) ? value : `Station ${value}`
}

function formatDuration(start, end = new Date()) {
  if (!start) return 'Unavailable'
  const elapsedSeconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000))
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export default function App() {
  const [view, setView] = useState('home')
  const [pendingAction, setPendingAction] = useState('open')
  const [selectedStation, setSelectedStation] = useState(null)
  const [participants, setParticipants] = useState([])
  const [pendingRegistration, setPendingRegistration] = useState(null)
  const [closedSession, setClosedSession] = useState(null)
  const [closingParticipants, setClosingParticipants] = useState([])
  const [closeRejectedStudent, setCloseRejectedStudent] = useState('')
  const [scanFeedback, setScanFeedback] = useState(null)
  const [scanPhoto, setScanPhoto] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Ready for the next cabinet session.')
  const [errorMessage, setErrorMessage] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [cabinetState, setCabinetState] = useState({ sessions: [] })
  const { sessions } = cabinetState
  const [readerContext, setReaderContext] = useState(null)
  const [bridgeConnectionStatus, setBridgeConnectionStatus] = useState('connecting')
  const [workflowLoaded, setWorkflowLoaded] = useState(false)
  const selectedSession = sessions.find((session) => session.status === 'open' && session.station === selectedStation) || null
  const [serviceStatus, setServiceStatus] = useState(null)
  const [accessState, setAccessState] = useState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
  const nfcScanCursorRef = useRef(loadNfcScanCursor())
  const participantsByUidRef = useRef(new Map())
  const closingParticipantsRef = useRef([])
  const bridgePollingRef = useRef(false)
  const bridgeAbortControllerRef = useRef(null)
  const bridgeErrorRef = useRef('')
  const photoEventIdRef = useRef(null)

  const loadScanPhoto = useCallback((event) => {
    const eventId = getDjangoAccessLogEventId(event)
    if (!eventId) {
      photoEventIdRef.current = null
      setScanPhoto({ state: 'unavailable', label: 'Unavailable', imageBlob: null, diagnosticError: null })
      return
    }

    photoEventIdRef.current = eventId
    setScanPhoto({ eventId, state: 'pending', label: 'Pending', imageBlob: null, diagnosticError: null })
    const refreshPhoto = async () => {
      for (let attempt = 0; attempt < PHOTO_STATUS_ATTEMPTS; attempt += 1) {
        if (photoEventIdRef.current !== eventId) return
        try {
          const photo = await fetchAccessLogPhoto(eventId)
          if (photoEventIdRef.current !== eventId) return
          if (photo.state !== 'pending' && photo.captureStatus !== null) {
            setScanPhoto(photo)
            return
          }
        } catch {
          // A fresh capture may still be in progress while the status endpoint recovers.
        }
        if (attempt + 1 < PHOTO_STATUS_ATTEMPTS) {
          await new Promise((resolve) => window.setTimeout(resolve, PHOTO_STATUS_RETRY_DELAY_MS))
        }
      }
      if (photoEventIdRef.current === eventId) {
        setScanPhoto({ eventId, state: 'unavailable', label: 'Unavailable', imageBlob: null, diagnosticError: null })
      }
    }
    void refreshPhoto()
  }, [])

  const requestScanPhotoCapture = useCallback((event) => {
    const eventId = getDjangoAccessLogEventId(event)
    if (!eventId) return
    captureAccessLogPhoto(eventId).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchCabinetWorkflow()
      .then((data) => {
        if (cancelled) return
        setBridgeConnectionStatus('connected')
        const stations = (data.stations || []).map((item) => item.name)
        setReaderContext({
          mode: data.mode,
          cabinetName: data.cabinet_name,
          stations,
        })
        const sessions = (data.stations || []).map((item) => normalizeServerSession(item.session)).filter(Boolean)
        setCabinetState({ sessions })
        setWorkflowLoaded(true)
      })
      .catch((error) => {
        if (!cancelled) {
          setBridgeConnectionStatus('unavailable')
          setErrorMessage(error.message || 'NFC bridge unavailable. Check the NFC service connection.')
          setWorkflowLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (view !== 'home' && view !== 'participant-scan' && view !== 'close-scan') return undefined

    let cancelled = false
    let pauseAfterDecision = false
    const processScanEvent = (event) => {
      const eventId = Number(event?.event_id)
      if (!Number.isSafeInteger(eventId) || eventId < 1) {
        throw new Error('NFC bridge returned an invalid event ID.')
      }
      if (eventId <= nfcScanCursorRef.current) return

      const uid = String(event.uid || '').trim()
      if (!uid) throw new Error(`NFC event ${eventId} is missing its UID.`)

      if (event.status === 'registered') {
        const name = String(event.name || '').trim()
        const studentId = String(event.student_id || '').trim()
        const role = String(event.role || '').trim().toLowerCase()
        if (!name || !studentId || !role) {
          throw new Error(`NFC event ${eventId} is missing registered student details.`)
        }

        setAccessState({ status: 'success', name, studentId, role, message: '', registrationUrl: '' })
        if (view === 'participant-scan') {
          if (role !== 'student') {
            setScanFeedback({ type: 'warning', message: 'Only student cards can join', participant: null })
            setStatusMessage('Use a student card for this session.')
          } else if (participantsByUidRef.current.has(uid)) {
            const duplicate = participantsByUidRef.current.get(uid)
            setScanFeedback({ type: 'duplicate', message: 'Already scanned', participant: duplicate || null })
            setStatusMessage(`${duplicate?.fullName || 'This student'} is already in this session.`)
          } else {
            const participant = { uid, fullName: name, studentId, section: String(event.section || '') }
            participantsByUidRef.current.set(uid, participant)
            setParticipants((current) => [...current, participant])
            setScanFeedback({ type: 'success', message: 'Participant added', participant })
            setStatusMessage('Participant added successfully.')
          }
        } else if (view === 'close-scan') {
          pauseAfterDecision = true
          const isMember = role === 'student' && (
            selectedSession?.opened_by?.some((student) => student.studentId === studentId || student.uid === uid)
            || selectedSession?.openedByStudentIds?.includes(studentId)
            || selectedSession?.openedByUids?.includes(uid)
          )
          if (isMember) {
            const participant = { uid, fullName: name, studentId, section: String(event.section || '') }
            const attendanceResult = recordClosingAttendance(selectedSession, closingParticipantsRef.current, participant)
            if (attendanceResult.status === 'duplicate') {
              setScanFeedback({ type: 'duplicate', message: 'Already scanned for closing', participant: attendanceResult.participant })
              setStatusMessage(`${attendanceResult.participant.fullName || 'This member'} is already in closing attendance.`)
            } else if (attendanceResult.status === 'added') {
              closingParticipantsRef.current = attendanceResult.attendance
              setClosingParticipants(attendanceResult.attendance)
              setScanFeedback({ type: 'success', message: 'Closing attendance recorded', participant })
              setStatusMessage(`${name} added to closing attendance (${attendanceResult.attendance.length}).`)
              setAccessState({ status: 'success', name, studentId, role: 'student', message: '' })
            }
            setCloseRejectedStudent('')
          } else {
            setCloseRejectedStudent(name || studentId || 'Unknown NFC card')
            setView('close-not-authorized')
          }
        }
        setErrorMessage('')
      } else if (event.status === 'unregistered') {
        if (event.registration_required !== true || typeof event.registration_url !== 'string') {
          throw new Error(`NFC event ${eventId} is missing registration details.`)
        }
        if (view === 'close-scan') {
          pauseAfterDecision = true
          setCloseRejectedStudent('Unknown NFC card')
          setView('close-not-authorized')
        } else {
          const registrationUrl = event.registration_url
          setAccessState({
            status: 'registration',
            name: '',
            studentId: '',
            role: '',
            message: 'Please scan this QR code to register your card.',
            registrationUrl,
          })
          if (view === 'participant-scan') {
            pauseAfterDecision = true
            setPendingRegistration({ uid, registrationUrl })
            setStatusMessage('This NFC card is not linked to a student.')
            setView('unregistered-card')
          }
        }
        setErrorMessage('')
      } else if (event.status === 'error') {
        const message = String(event.error || 'NFC verification failed.')
        setAccessState({ status: 'error', name: '', studentId: '', role: '', message, registrationUrl: '' })
        if (view === 'close-scan') {
          pauseAfterDecision = true
          setCloseRejectedStudent('NFC card could not be verified')
          setView('close-not-authorized')
        } else if (view === 'participant-scan') {
          setScanFeedback({ type: 'warning', message: 'NFC verification failed', detail: message, participant: null })
          setStatusMessage('The NFC reader could not verify this card.')
        }
        setErrorMessage(message)
      } else {
        throw new Error(`NFC event ${eventId} has an unsupported status.`)
      }

      requestScanPhotoCapture(event)
      loadScanPhoto(event)

      nfcScanCursorRef.current = eventId
      try {
        localStorage.setItem(NFC_SCAN_CURSOR_KEY, String(eventId))
      } catch (error) {
        console.warn('Unable to persist NFC scan cursor.', error)
      }
    }

    const pollScanBridge = async () => {
      if (bridgePollingRef.current || cancelled) return
      bridgePollingRef.current = true
      const controller = new AbortController()
      bridgeAbortControllerRef.current = controller

      try {
        let hasMore = true
        while (hasMore && !cancelled) {
          const previousCursor = nfcScanCursorRef.current
          const batch = await fetchScanEvents(previousCursor, { signal: controller.signal })
          if (cancelled) return
          setBridgeConnectionStatus('connected')
          if (batch.has_more && batch.events.length === 0) {
            throw new Error('NFC bridge reported more events but returned none.')
          }

          if (bridgeErrorRef.current) {
            bridgeErrorRef.current = ''
            setAccessState((current) => current.status === 'error'
              ? { status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' }
              : current)
            setScanFeedback((current) => current?.type === 'bridge-error' ? null : current)
            setErrorMessage('')
            setStatusMessage('Ready for the next cabinet session.')
          }

          for (const event of batch.events) {
            if (cancelled) break
            processScanEvent(event)
            if (pauseAfterDecision) break
          }
          if (pauseAfterDecision) break
          hasMore = batch.has_more
          if (hasMore && nfcScanCursorRef.current <= previousCursor) {
            throw new Error('NFC bridge did not advance its event cursor.')
          }
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          const message = error.message || 'NFC bridge unavailable. Check the NFC service connection.'
          setBridgeConnectionStatus('unavailable')
          setErrorMessage(message)
          if (bridgeErrorRef.current !== message) {
            bridgeErrorRef.current = message
            setAccessState({ status: 'error', name: '', studentId: '', role: '', message, registrationUrl: '' })
            if (view === 'participant-scan') {
              setScanFeedback({ type: 'bridge-error', message })
              setStatusMessage('NFC reader unavailable. Retrying connection.')
            }
          }
        }
      } finally {
        bridgePollingRef.current = false
        if (bridgeAbortControllerRef.current === controller) bridgeAbortControllerRef.current = null
      }
    }

    void pollScanBridge()
    const intervalId = window.setInterval(() => void pollScanBridge(), 750)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      bridgeAbortControllerRef.current?.abort()
    }
  }, [view, selectedSession, loadScanPhoto, requestScanPhotoCapture])

  useEffect(() => {
    if (view !== 'status-screen') return undefined
    let cancelled = false
    fetchNfcServiceStatus()
      .then((data) => {
        if (!cancelled) setServiceStatus(data)
      })
      .catch((error) => {
        if (!cancelled) {
          setBridgeConnectionStatus('unavailable')
          setServiceStatus({ mode: 'unavailable', error: error.message || 'NFC bridge unavailable. Check the NFC service connection.' })
        }
      })
    return () => { cancelled = true }
  }, [view])

  const occupiedStations = useMemo(() => {
    return sessions
      .filter((session) => session.status === 'open')
      .map((session) => session.station)
  }, [sessions])
  const readerStations = readerContext?.stations || []

  function updateStationSession(session) {
    if (!session) return
    setCabinetState((current) => ({
      sessions: [...current.sessions.filter((item) => item.station !== session.station), session],
    }))
  }

  async function refreshCabinetWorkflow() {
    const state = await fetchCabinetWorkflow()
    setCabinetState({
      sessions: (state.stations || []).map((item) => normalizeServerSession(item.session)).filter(Boolean),
    })
  }

  function resetToHome() {
    if (selectedSession && selectedSession.workflow_state !== 'idle') {
      void sendCabinetWorkflow('cancel', { station: selectedStation })
        .then(refreshCabinetWorkflow)
        .catch((error) => setErrorMessage(error.message || 'The active cabinet workflow could not be cancelled.'))
    }
    setView('home')
    setPendingAction('open')
    setSelectedStation(null)
    setParticipants([])
    setPendingRegistration(null)
    setClosedSession(null)
    closingParticipantsRef.current = []
    setClosingParticipants([])
    setCloseRejectedStudent('')
    participantsByUidRef.current.clear()
    setScanFeedback(null)
    setScanPhoto(null)
    photoEventIdRef.current = null
    setErrorMessage('')
    setStatusMessage('Ready for the next cabinet session.')
  }

  function startOpenSession() {
    setPendingAction('open')
    setSelectedStation(null)
    setParticipants([])
    setPendingRegistration(null)
    closingParticipantsRef.current = []
    setClosingParticipants([])
    setCloseRejectedStudent('')
    participantsByUidRef.current.clear()
    setScanFeedback(null)
    setScanPhoto(null)
    photoEventIdRef.current = null
    setErrorMessage('')
    setStatusMessage('Choose a station to begin.')
    setView('station-select')
  }

  function startCloseSession() {
    setPendingAction('close')
    setSelectedStation(null)
    closingParticipantsRef.current = []
    setClosingParticipants([])
    setCloseRejectedStudent('')
    setScanFeedback(null)
    setScanPhoto(null)
    photoEventIdRef.current = null
    setErrorMessage('')
    if (!sessions.some((session) => session.status === 'open')) {
      setView('close-select')
      return
    }
    setStatusMessage('Choose a station to close.')
    setView('close-select')
  }

  function resumeOpeningSession(session) {
    const scannedStudents = session.opened_by || []
    setPendingAction('open')
    setSelectedStation(session.station)
    setParticipants(scannedStudents.map((student) => ({
      uid: student.uid,
      fullName: student.fullName,
      studentId: student.studentId,
    })))
    participantsByUidRef.current = new Map(
      scannedStudents.filter((student) => student.uid).map((student) => [student.uid, student]),
    )
    setClosingParticipants([])
    closingParticipantsRef.current = []
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage(`${scannedStudents.length} students already recorded. Continue scanning to finish opening.`)
    setView('participant-scan')
  }

  async function handleStationSelect(station) {
    const activeSession = sessions.find((session) => session.status === 'open' && session.station === station)
    if (activeSession?.workflow_state === 'opening') {
      resumeOpeningSession(activeSession)
      return
    }
    if (activeSession) {
      setSelectedStation(station)
      setView('already-open')
      return
    }

    try {
      if (!workflowLoaded) throw new Error('Loading configured stations...')
      const data = await sendCabinetWorkflow('open', { station })
      const session = normalizeServerSession(data.session)
      updateStationSession(session)
      setSelectedStation(data.station)
      setErrorMessage('')
      setStatusMessage(`Tap each group member’s NFC card for ${stationLabel(data.station)}.`)
      setView('participant-scan')
    } catch (error) {
      setErrorMessage(error.message || 'The cabinet session could not be opened.')
    }
  }

  async function selectSessionToClose(station) {
    const activeSession = sessions.find((session) => session.status === 'open' && session.station === station)
    if (!activeSession) {
      setSelectedStation(station)
      setView('already-closed')
      return
    }
    if (activeSession.workflow_state === 'opening') {
      resumeOpeningSession(activeSession)
      return
    }
    if (activeSession.workflow_state === 'closing') {
      const scannedStudents = activeSession.closed_by || []
      closingParticipantsRef.current = scannedStudents.map((student) => ({
        uid: student.uid,
        fullName: student.fullName,
        studentId: student.studentId,
      }))
      setClosingParticipants(closingParticipantsRef.current)
      setSelectedStation(station)
      setPendingAction('close')
      setErrorMessage('')
      setStatusMessage('Continue scanning closing attendance for this station.')
      setView('close-scan')
      return
    }
    try {
      const data = await sendCabinetWorkflow('start_close', { station })
      const session = normalizeServerSession(data.session)
      updateStationSession(session)
      setSelectedStation(data.station)
      closingParticipantsRef.current = []
      setClosingParticipants([])
      setCloseRejectedStudent('')
      setScanFeedback(null)
      setErrorMessage('')
      setStatusMessage(`Tap NFC cards to record closing attendance for ${stationLabel(data.station)}.`)
      setView('close-scan')
    } catch (error) {
      setErrorMessage(error.message || 'The cabinet session could not be closed.')
    }
  }

  function isActiveSessionMember(uid, studentId) {
    return isSessionMember(selectedSession, { uid, studentId })
  }

  function retryCloseScan() {
    setCloseRejectedStudent('')
    setScanFeedback(null)
    setScanPhoto(null)
    photoEventIdRef.current = null
    setErrorMessage('')
    setStatusMessage('Tap NFC cards to record closing attendance.')
    setView('close-scan')
  }

  function openRegistrationPage() {
    if (!pendingRegistration?.registrationUrl) {
      setErrorMessage('A registration link is not available. Tap the unregistered card again.')
      return
    }
    setErrorMessage('')
    setView('nfc-registration')
  }

  function resumeParticipantScan({ skipped = false } = {}) {
    setPendingRegistration(null)
    setAccessState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
    setScanFeedback(null)
    setScanPhoto(null)
    photoEventIdRef.current = null
    setErrorMessage('')
    setStatusMessage(skipped
      ? `${participants.length} participants ready. The unregistered card was skipped.`
      : `${participants.length} participants ready. Tap the registered card again after registration.`)
    setView('participant-scan')
  }


  function continueToConfirmation() {
    if (participants.length === 0) {
      setErrorMessage('Scan at least one participant before continuing.')
      return
    }

    setErrorMessage('')
    setView('confirm-session')
  }

  function continueToCloseConfirmation() {
    if (closingParticipants.length === 0) {
      setErrorMessage('Scan at least one session member before closing the station.')
      return
    }
    setErrorMessage('')
    setView('confirm-session')
  }

  async function finalizeSession() {
    if (pendingAction === 'open') {
      if (!selectedStation || !selectedSession || selectedSession.workflow_state !== 'opening') {
        setErrorMessage('Start an opening workflow for the selected station before opening the cabinet.')
        setView('station-select')
        return
      }
      try {
        const data = await sendCabinetWorkflow('finish_open', { station: selectedStation })
        const session = normalizeServerSession(data.session)
        updateStationSession(session)
        setStatusMessage(`Open workflow completed for ${stationLabel(data.station)}. Physical shutter movement was not verified.`)
        setView('cabinet-opened')
      } catch (error) {
        setErrorMessage(error.message || 'The cabinet session could not be opened.')
      }
      return
    }

    if (!selectedSession) {
      setErrorMessage('No active session is available to close.')
      setView('close-select')
      return
    }

    if (closingParticipants.length === 0 || closingParticipants.some((participant) => (
      !isActiveSessionMember(participant.uid, participant.studentId)
    ))) {
      setErrorMessage(`Scan at least one member of the ${stationLabel(selectedStation)} active session before closing.`)
      setView('close-scan')
      return
    }

    try {
      const data = await sendCabinetWorkflow('finish_close', { station: selectedStation })
      const session = normalizeServerSession(data.session)
      updateStationSession(session)
      setClosedSession(session)
      setStatusMessage(`Close workflow completed for ${stationLabel(data.station)}. Physical shutter movement was not verified.`)
      setView('cabinet-closed')
    } catch (error) {
      setErrorMessage(error.message || 'The cabinet session could not be closed.')
    }
  }

  return (
    <div className="app-root">
      {view === 'home' && (
        <Screen>
          <div className="home-shell">
            <div className="hero-card cabinet-home-card">
              <img className="brand-wordmark" src="/logo1.png" alt="TapTrack" />
              <div className="title-block">
                <h1 className="title">Cabinet Management</h1>
                <p className="muted" role="status">
                  {bridgeConnectionStatus === 'connected'
                    ? 'Connected to the real NFC bridge.'
                    : bridgeConnectionStatus === 'unavailable'
                      ? 'NFC bridge unavailable. Check the NFC service connection.'
                      : 'Connecting to the NFC bridge…'}
                </p>
              </div>
              <div className="station-status-grid" aria-label="Cabinet station status">
                {readerStations.map((station) => {
                  const session = sessions.find((item) => item.status === 'open' && item.station === station)
                  return (
                    <div className={`station-status-card ${session ? 'is-open' : 'is-available'}`} key={station}>
                      <strong>{stationLabel(station).toUpperCase()}</strong>
                      <span className="station-status-label"><span className={`status-dot ${session ? 'warning-dot' : 'good'}`} />{session ? 'OCCUPIED' : 'AVAILABLE'}</span>
                      {session ? <span>Opened by {getParticipantCount(session)}</span> : <span>Ready</span>}
                      {session && <small>Opened {formatSessionTime(session.openedAt)}</small>}
                    </div>
                  )
                })}
              </div>
              {accessState.status === 'error' && <p className="muted">{accessState.message}</p>}
              <div className="clock-card">
                <span className="clock-label">Current time</span>
                <span className="clock-time">{formatDateTime(clock)}</span>
              </div>
            </div>

            <div className="home-actions">
              <button className="btn primary home-action" onClick={startOpenSession}>OPEN CABINET</button>
              <button className="btn secondary home-action" onClick={startCloseSession}>CLOSE CABINET</button>
              <button className="btn ghost home-action" onClick={() => setView('status-screen')}>Cabinet Status</button>
            </div>
            {errorMessage && <div className="error-banner" role="alert">{errorMessage}</div>}
          </div>
        </Screen>
      )}

      {view === 'already-open' && (
        <Screen>
          <div className="panel status-panel">
            <div className="large-state is-open"><span className="status-dot warning-dot" /><strong>CABINET OPEN</strong></div>
            <h2>Cabinet is already open.</h2>
            <p className="muted">The active session must be closed before another can begin.</p>
            <div className="confirm-list">
              <div className="confirm-row"><span>Station</span><strong>{selectedSession?.station}</strong></div>
              <div className="confirm-row"><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div className="confirm-row"><span>Opened</span><strong>{formatSessionTime(selectedSession?.openedAt)}</strong></div>
            </div>
            <div className="button-row">
              <button className="btn primary" onClick={() => setView('cabinet-opened')}>VIEW SESSION</button>
              <button className="btn ghost" onClick={resetToHome}>BACK TO HOME</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'close-scan' && (
        <Screen>
          <div className="panel status-panel">
            <div className="large-state is-open"><span className="status-dot warning-dot" /><strong>ACTIVE SESSION</strong></div>
            <h2>Close Station {selectedStation}</h2>
            <div className="status-chip">
              <span className={`status-dot ${scanFeedback?.type === 'success' ? 'good' : scanFeedback?.type === 'duplicate' ? 'warning-dot' : 'good'}`} />
              <span>{statusMessage || 'Tap NFC cards to record closing attendance.'}</span>
            </div>
            <AccessPhotoDetails photo={scanPhoto} />
            <div className="confirm-list">
              <div className="confirm-row"><span>Session Status</span><strong>ACTIVE</strong></div>
              <div className="confirm-row"><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div className="confirm-row"><span>Closed by</span><strong>{closingParticipants.length}</strong></div>
              <div className="confirm-row"><span>Opened</span><strong>{formatSessionTime(selectedSession?.openedAt)}</strong></div>
            </div>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(selectedSession?.opened_by || []).map((participant) => (
                <div key={participant.uid} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div><strong>{participant.fullName}</strong><p>{participant.studentId}</p></div>
                </div>
              ))}
            </div>
            <div className="participant-list session-participants">
              <h3>Closed by</h3>
              {closingParticipants.length === 0
                ? <div className="empty-state">No closing attendance recorded yet.</div>
                : closingParticipants.map((participant) => (
                  <div key={participant.uid || participant.studentId} className="participant-card">
                    <div className="participant-badge">✓</div>
                    <div><strong>{participant.fullName}</strong><p>{participant.studentId}</p></div>
                  </div>
                ))}
            </div>
            {errorMessage && <div className="error-banner">{errorMessage}</div>}
            <div className="scan-prompt" role="status">Tap member NFC cards on the NFC reader to record closing attendance.</div>
            <div className="button-row stacked">
              <button className="btn primary" onClick={continueToCloseConfirmation} disabled={closingParticipants.length === 0}>CLOSE CABINET</button>
              <button className="btn ghost" onClick={() => setView('close-select')}>CANCEL</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'close-not-authorized' && (
        <Screen>
          <div className="panel status-panel">
            <div className="large-state is-closed"><span className="status-dot warning-dot" /><strong>NOT AUTHORIZED</strong></div>
            <h2>You are not a member of the {stationLabel(selectedStation)} active session.</h2>
            <p className="muted">Only a member of this station’s session can close it.</p>
            {closeRejectedStudent && <p className="muted">Card scanned: {closeRejectedStudent}</p>}
            <div className="button-row">
              <button className="btn primary" onClick={retryCloseScan}>OK</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'already-closed' && (
        <Screen>
          <div className="panel status-panel">
            <div className="large-state is-closed"><span className="status-dot good" /><strong>CABINET CLOSED</strong></div>
            <h2>{selectedStation ? `${stationLabel(selectedStation)} is already closed.` : 'Cabinet is already closed.'}</h2>
            <div className="button-row">
              <button className="btn primary" onClick={resetToHome}>BACK TO HOME</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'unregistered-card' && (
        <Screen>
          <div className="panel status-panel">
            <div className="large-state is-closed"><span className="status-dot warning-dot" /><strong>NFC CARD NOT REGISTERED</strong></div>
            <h2>This card is not linked to a student.</h2>
            <p className="muted">Your scanned participants are saved. Register this card, skip it, or return to scanning.</p>
            <div className="confirm-list">
              <div className="confirm-row">
                <span>Participants already scanned</span>
                <strong>{participants.length}</strong>
              </div>
              <AccessPhotoDetails photo={scanPhoto} />
              <div className="participant-list">
                {participants.map((participant) => (
                  <div key={participant.uid} className="participant-card">
                    <div className="participant-badge">✓</div>
                    <div><strong>{participant.fullName}</strong><p>{participant.studentId}</p></div>
                  </div>
                ))}
              </div>
            </div>
            {pendingRegistration?.registrationUrl && (
              <div className="registration-qr">
                <QRCodeSVG value={pendingRegistration.registrationUrl} size={280} bgColor="#ffffff" fgColor="#002B5B" level="M" />
              </div>
            )}
            <div className="button-row stacked">
              <button className="btn primary registration-link" type="button" onClick={openRegistrationPage} disabled={!pendingRegistration?.registrationUrl}>REGISTER THIS CARD</button>
              <button className="btn secondary" onClick={() => resumeParticipantScan({ skipped: true })}>SKIP FOR NOW</button>
              <button className="btn ghost" onClick={() => resumeParticipantScan()}>BACK TO SCANNING</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'nfc-registration' && (
        <Screen>
          <div className="panel nfc-registration-panel">
            <h2>Register NFC Card</h2>
            {pendingRegistration?.registrationUrl ? (
              <>
                <p className="muted">Complete the existing TapTrack registration form below. If this link has expired or was already used, tap the card again to get a fresh link.</p>
                <iframe
                  className="nfc-registration-frame"
                  src={pendingRegistration.registrationUrl}
                  title="NFC card registration"
                  referrerPolicy="no-referrer"
                />
                <p className="muted">If the form cannot load here, <a href={pendingRegistration.registrationUrl} rel="noreferrer">open registration in this Cabinet window</a>.</p>
              </>
            ) : (
              <p className="error-banner" role="alert">A registration link is not available. Tap the unregistered card again.</p>
            )}
            <div className="button-row">
              <button className="btn secondary" type="button" onClick={() => setView('unregistered-card')}>BACK TO CARD</button>
              <button className="btn ghost" type="button" onClick={() => resumeParticipantScan()}>BACK TO SCANNING</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'station-select' && (
        <Screen>
          <div className="panel">
            <h2>Select Station</h2>
            {!workflowLoaded && <div className="empty-state" role="status">Loading configured stations...</div>}
            {workflowLoaded && readerStations.length === 0 && (
              <div className="empty-state" role="status">No stations are configured.</div>
            )}
            <div className="station-grid">
              {readerStations.map((station) => {
                const session = sessions.find((item) => item.status === 'open' && item.station === station)
                const resuming = session?.workflow_state === 'opening'
                return (
                  <button
                    key={station}
                    className="btn station-button"
                    onClick={() => handleStationSelect(station)}
                    disabled={Boolean(session && !resuming)}
                  >
                    <span>{stationLabel(station).toUpperCase()}</span>
                    <small>{resuming ? 'RESUME OPENING' : session ? 'OCCUPIED' : 'AVAILABLE'}</small>
                  </button>
                )
              })}
            </div>
            {errorMessage && <div className="error-banner">{errorMessage}</div>}
            <div className="button-row">
              <button className="btn ghost" onClick={resetToHome}>Cancel</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'close-select' && (
        <Screen>
          <div className="panel">
            <h2>Close Cabinet</h2>
            <p className="muted">Active sessions by station</p>
            {!occupiedStations.length && <div className="large-state is-closed"><span className="status-dot good" /><strong>ALL CABINETS CLOSED</strong></div>}
            <div className="station-grid">
              {readerStations.map((station) => {
                const session = sessions.find((item) => item.status === 'open' && item.station === station)
                return (
                  <div className={`station-status-card close-station-card ${session ? 'is-open' : 'is-available'}`} key={station}>
                    <strong>{stationLabel(station).toUpperCase()}</strong>
                    <span className="station-status-label"><span className={`status-dot ${session ? 'warning-dot' : 'good'}`} />{session ? session.workflow_state === 'closing' ? 'CLOSING' : session.workflow_state === 'opening' ? 'OPENING' : 'OCCUPIED' : 'AVAILABLE'}</span>
                    {session ? <>
                      <span>Opened by {getParticipantCount(session)}</span>
                      <small>Opened {formatSessionTime(session.openedAt)}</small>
                      <button
                        className="btn primary"
                        onClick={() => session.workflow_state === 'opening'
                          ? resumeOpeningSession(session)
                          : selectSessionToClose(station)}
                      >
                        {session.workflow_state === 'opening'
                          ? 'RESUME OPENING'
                          : session.workflow_state === 'closing'
                            ? 'CONTINUE CLOSING'
                            : `CLOSE ${stationLabel(station).toUpperCase()}`}
                      </button>
                    </> : <>
                      <span>No active session</span>
                      <button className="btn ghost" onClick={() => selectSessionToClose(station)}>CLOSE {stationLabel(station).toUpperCase()}</button>
                    </>}
                  </div>
                )
              })}
            </div>
            {errorMessage && <div className="error-banner">{errorMessage}</div>}
            <div className="button-row"><button className="btn ghost" onClick={resetToHome}>BACK TO HOME</button></div>
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
              <h2>Scan Group Members</h2>
              <p className="muted">Tap each registered NFC card.</p>
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
                    <strong>{scanFeedback.message}</strong>
                    <p>{scanFeedback.participant?.fullName || 'That card has already been recorded.'}</p>
                  </div>
                </div>
              )}
              {scanFeedback?.type === 'warning' && (
                <div className="feedback-banner warning">
                  <span className="feedback-check">!</span>
                  <div>
                    <strong>{scanFeedback.message}</strong>
                    <p>{scanFeedback.detail || 'Try another registered card.'}</p>
                  </div>
                </div>
              )}
              {scanFeedback?.type === 'bridge-error' && (
                <div className="feedback-banner warning">
                  <span className="feedback-check">!</span>
                  <div>
                    <strong>NFC reader unavailable</strong>
                    <p>{scanFeedback.message}</p>
                  </div>
                </div>
              )}
              {scanFeedback?.type === 'registration' && (
                <div className="feedback-banner warning">
                  <span className="feedback-check">!</span>
                  <div>
                    <strong>Card not registered</strong>
                    <p>{scanFeedback.message}</p>
                    <div className="registration-qr">
                      <QRCodeSVG value={scanFeedback.registrationUrl} size={160} bgColor="#ffffff" fgColor="#071826" level="M" />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <AccessPhotoDetails photo={scanPhoto} />
            {errorMessage && <div className="error-banner">{errorMessage}</div>}

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Participants</h3>
                <span>Participants scanned: {participants.length}</span>
              </div>
              <div className="participant-list">
                {participants.length === 0 ? (
                  <div className="empty-state">No participants scanned yet.</div>
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
              <div className="scan-prompt" role="status">Tap a student NFC card on the NFC reader…</div>
              <div className="button-row inline">
                <button className="btn secondary" onClick={continueToConfirmation}>CONTINUE</button>
                <button className="btn ghost" onClick={resetToHome}>CANCEL</button>
              </div>
            </div>
          </div>
        </Screen>
      )}

      {view === 'confirm-session' && (
        <Screen>
          <div className="panel confirm-panel">
            <h2>{pendingAction === 'open' ? 'Confirm Open Cabinet' : 'Confirm Close Cabinet'}</h2>
            <p className="muted">{pendingAction === 'open' ? 'Review the station and group members before opening.' : 'Are you sure you want to close this cabinet session?'}</p>
            <div className="confirm-list">
              <div className="confirm-row">
                <span>Station</span>
                <strong>{pendingAction === 'open' ? selectedStation : selectedSession?.station}</strong>
              </div>
              <div className="confirm-row">
                <span>Opened by</span>
                <strong>{pendingAction === 'open' ? participants.length : getParticipantCount(selectedSession)}</strong>
              </div>
              {pendingAction === 'close' && (
                <>
                  <div className="confirm-row"><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
                  <div className="confirm-row"><span>Closed by</span><strong>{closingParticipants.length}</strong></div>
                  <div className="confirm-row"><span>Opened</span><strong>{formatSessionTime(selectedSession?.openedAt)}</strong></div>
                  <div className="confirm-row"><span>Current duration</span><strong>{formatDuration(selectedSession?.openedAt, clock)}</strong></div>
                </>
              )}
            </div>
            <div className="participant-list">
              {(pendingAction === 'open' ? participants : closingParticipants).map((participant, index) => (
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
              {pendingAction === 'open'
                ? <button className="btn ghost" onClick={() => setView('participant-scan')}>BACK</button>
                : <button className="btn ghost" onClick={() => setView('close-scan')}>BACK TO SCANNING</button>}
              <button className="btn primary" onClick={finalizeSession}>{pendingAction === 'open' ? 'OPEN CABINET' : `CLOSE ${stationLabel(selectedStation).toUpperCase()}`}</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-opened' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <img className="brand-wordmark compact-wordmark" src="/logo1.png" alt="TapTrack" />
            <div className="large-state is-open"><span className="status-dot warning-dot" /><strong>OPEN WORKFLOW COMPLETE</strong></div>
            <h2>Open Workflow Complete</h2>
            <p className="muted">Physical shutter movement was not verified.</p>
            <div className="session-metrics">
              <div><span>Station</span><strong>{selectedSession?.station}</strong></div>
              <div><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div><span>Session Duration</span><strong>{formatDuration(selectedSession?.openedAt, clock)}</strong></div>
            </div>
            <p className="session-id">Session {selectedSession?.id || 'active'}</p>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(selectedSession?.opened_by || []).map((participant) => (
                <div key={participant.uid} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div><strong>{participant.fullName}</strong><p>{participant.studentId}</p></div>
                </div>
              ))}
            </div>
            <div className="button-row stacked">
              <button className="btn primary" onClick={startCloseSession}>START CLOSE WORKFLOW</button>
              <button className="btn ghost" onClick={resetToHome}>BACK TO HOME</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-closed' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="large-state is-closed"><span className="status-dot good" /><strong>CLOSE WORKFLOW COMPLETE</strong></div>
            <h2>Close Workflow Complete</h2>
            <p className="muted">{stationLabel(selectedStation)} session is marked closed. Physical shutter movement was not verified.</p>
            <div className="session-metrics">
              <div><span>Opened by</span><strong>{getParticipantCount(closedSession)}</strong></div>
              <div><span>Closed by</span><strong>{closedSession?.closed_by?.length || 0}</strong></div>
              <div><span>Session Duration</span><strong>{formatDuration(closedSession?.openedAt, closedSession?.closedAt)}</strong></div>
            </div>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(closedSession?.opened_by || []).map((student) => (
                <div key={student.uid || student.studentId} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div><strong>{student.fullName}</strong><p>{student.studentId}</p></div>
                </div>
              ))}
            </div>
            <div className="participant-list session-participants">
              <h3>Closed by</h3>
              {(closedSession?.closed_by || []).map((student) => (
                <div key={student.uid || student.studentId} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div><strong>{student.fullName}</strong><p>{student.studentId}</p></div>
                </div>
              ))}
            </div>
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
            <p className="muted">Current cabinet state and session history.</p>
            {serviceStatus && (
              <div className="status-card" role="status">
                <strong>NFC bridge: {serviceStatus.service === 'ready' ? 'Connected' : 'Unavailable'}</strong>
                {serviceStatus.reader_connected !== undefined && (
                  <p>Physical NFC reader: {serviceStatus.reader_connected ? 'Connected' : 'Waiting for reader'}</p>
                )}
                {serviceStatus.error && <p role="alert">{serviceStatus.error}</p>}
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
