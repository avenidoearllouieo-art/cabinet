import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { getDjangoAccessLogEventId } from './services/accessLogPhoto'
import { isSessionMember, recordClosingAttendance } from './services/cabinetAttendance'
import { motorDispatchStatus } from './utils/motorDispatchStatus.js'
import {
  CabinetAnimation,
  EmptyState,
  ErrorMessage,
  KioskIcon,
  LoadingIndicator,
  NFCScanIndicator,
  ParticipantCard,
  SessionSummary,
  StationCard,
  StatusBadge,
  TapTrackHeader,
  WorkflowProgress,
} from './components/KioskComponents.jsx'
import {
  cancelEnrollmentRegistration,
  cancelPasswordRecovery,
  captureAccessLogPhoto,
  fetchCabinetWorkflow,
  fetchNfcServiceStatus,
  fetchPasswordRecoveryBridgeStatus,
  fetchPasswordRecoveryQueue,
  fetchPasswordRecoveryStatus,
  getEnrollmentStatus,
  fetchScanEvents,
  sendCabinetWorkflow,
  startPasswordRecovery,
} from './services/nfc/scanResultBridge'
import './App.css'
import './kiosk.css'

const NFC_SCAN_CURSOR_KEY = 'taptrack_cabinet_nfc_scan_cursor'
const SCAN_BRIDGE_POLL_INTERVAL_MS = 750
const RECOVERY_STATUS_POLL_INTERVAL_MS = 2000
const ENROLLMENT_STATUS_POLL_INTERVAL_MS = 2000
const RECOVERY_STATUS_MAX_BACKOFF_MS = 30000
const RECOVERY_VERIFIED_MESSAGE_MS = 4000
function Screen({ children, className = '' }) {
  return <main className={`screen ${className}`.trim()}>{children}</main>
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

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
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

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  return now
}

function CabinetClock() {
  const now = useCurrentTime()
  return <span className="clock-time">{formatDateTime(now)}</span>
}

function SessionDuration({ startedAt }) {
  const now = useCurrentTime()
  return <>{formatDuration(startedAt, now)}</>
}

const SCREEN_TITLES = {
  home: 'Cabinet Management',
  'password-recovery': 'Password Recovery',
  'station-select': 'Select Station',
  'participant-scan': 'Opening Attendance',
  'close-select': 'Close Cabinet',
  'close-scan': 'Closing Attendance',
  'confirm-session': 'Confirm Workflow',
  'cabinet-opening': 'Opening Cabinet',
  'cabinet-closing': 'Closing Cabinet',
  'cabinet-opened': 'Open Workflow Recorded',
  'cabinet-closed': 'Close Workflow Recorded',
  'status-screen': 'Cabinet Status',
  'unregistered-card': 'Register Your ID Card',
  'registration-success': 'Registration Complete',
  'registration-expired': 'Registration Expired',
  'close-not-authorized': 'Session Access Denied',
  'already-open': 'Station Occupied',
  'already-closed': 'No Active Session',
}

export default function App() {
  const [view, setView] = useState('home')
  const [pendingAction, setPendingAction] = useState('open')
  const [selectedStation, setSelectedStation] = useState(null)
  const [participants, setParticipants] = useState([])
  const [pendingRegistration, setPendingRegistration] = useState(null)
  const [registrationCountdown, setRegistrationCountdown] = useState(600)
  const [closedSession, setClosedSession] = useState(null)
  const [closingParticipants, setClosingParticipants] = useState([])
  const [closeRejectedStudent, setCloseRejectedStudent] = useState('')
  const [scanFeedback, setScanFeedback] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Ready for the next cabinet session.')
  const [motorStatusMessage, setMotorStatusMessage] = useState('Motor dispatch has not been reported for this session.')
  const [errorMessage, setErrorMessage] = useState('')
  const [cabinetState, setCabinetState] = useState({ sessions: [] })
  const { sessions } = cabinetState
  const [readerContext, setReaderContext] = useState(null)
  const [bridgeConnectionStatus, setBridgeConnectionStatus] = useState('connecting')
  const [workflowLoaded, setWorkflowLoaded] = useState(false)
  const [workflowBusy, setWorkflowBusy] = useState(false)
  const selectedSession = sessions.find((session) => session.status === 'open' && session.station === selectedStation) || null
  const [serviceStatus, setServiceStatus] = useState(null)
  const [recoveryQueue, setRecoveryQueue] = useState([])
  const [recoveryQueueLoading, setRecoveryQueueLoading] = useState(false)
  const [recoveryQueueError, setRecoveryQueueError] = useState('')
  const [recoveryQueueAttempt, setRecoveryQueueAttempt] = useState(0)
  const [recoveryRequestId, setRecoveryRequestId] = useState('')
  const [recoveryPhase, setRecoveryPhase] = useState('idle')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const [accessState, setAccessState] = useState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
  const nfcScanCursorRef = useRef(loadNfcScanCursor())
  const participantsByUidRef = useRef(new Map())
  const closingParticipantsRef = useRef([])
  const bridgePollingRef = useRef(false)
  const bridgeAbortControllerRef = useRef(null)
  const bridgeErrorRef = useRef('')
  const recoveryAbortControllerRef = useRef(null)
  const workflowRequestRef = useRef(false)
  const recoveryStartRef = useRef(false)

  const refreshCabinetWorkflow = useCallback(async () => {
    const state = await fetchCabinetWorkflow()
    setCabinetState({
      sessions: (state.stations || []).map((item) => normalizeServerSession(item.session)).filter(Boolean),
    })
  }, [])

  const resetToHome = useCallback(() => {
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
    setErrorMessage('')
    setStatusMessage('Ready for the next cabinet session.')
  }, [selectedSession, selectedStation, refreshCabinetWorkflow])

  useEffect(() => {
    if (!pendingRegistration?.registrationUrl) return undefined
    const expiresAt = new Date(pendingRegistration.expiresAt).getTime()
    const serverTime = new Date(pendingRegistration.serverTime).getTime()
    const clockOffset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0
    const fallbackExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 600000
    const tick = () => {
      const remaining = Math.max(0, Math.floor((fallbackExpiresAt - (Date.now() + clockOffset)) / 1000))
      setRegistrationCountdown(remaining)
    }
    tick()
    const intervalId = window.setInterval(tick, 1000)
    return () => window.clearInterval(intervalId)
  }, [pendingRegistration?.registrationUrl, pendingRegistration?.expiresAt, pendingRegistration?.serverTime])

  useEffect(() => {
    if (!pendingRegistration?.registrationUrl) return undefined
    let cancelled = false
    let timeoutId
    const poll = async () => {
      const token = new URL(pendingRegistration.registrationUrl).searchParams.get('token')
      if (!token) return
      try {
        const status = await getEnrollmentStatus(token)
        if (cancelled) return
        if (status.status === 'completed') {
          setPendingRegistration(null)
          setRegistrationCountdown(600)
          setView('registration-success')
          return
        }
        if (status.status === 'expired' || status.status === 'cancelled') {
          setPendingRegistration(null)
          setRegistrationCountdown(600)
          setView('registration-expired')
          return
        }
      } catch {
        // Keep the existing QR active if this poll is temporarily unavailable.
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, ENROLLMENT_STATUS_POLL_INTERVAL_MS)
    }
    void poll()
    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [pendingRegistration?.registrationUrl])

  useEffect(() => {
    if (view !== 'registration-success') return undefined
    const timeoutId = window.setTimeout(() => resetToHome(), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [view, resetToHome])

  async function runWorkflowCommand(command) {
    if (workflowRequestRef.current) return null
    workflowRequestRef.current = true
    setWorkflowBusy(true)
    try {
      return await command()
    } finally {
      workflowRequestRef.current = false
      setWorkflowBusy(false)
    }
  }

  useEffect(() => {
    if (view !== 'password-recovery') return undefined
    let cancelled = false
    let timeoutId

    const refreshQueue = async () => {
      setRecoveryQueueLoading(true)
      try {
        const queue = await fetchPasswordRecoveryQueue()
        if (cancelled) return
        setRecoveryQueue(queue)
        setRecoveryRequestId((currentId) => (
          recoveryPhase !== 'idle' || queue.some((item) => item.request_id === currentId)
            ? currentId
            : ''
        ))
        setRecoveryQueueError('')
      } catch (error) {
        if (!cancelled) {
          setRecoveryQueueError(error.message || 'Password-recovery queue is unavailable.')
          setRecoveryError('')
        }
      } finally {
        if (!cancelled) setRecoveryQueueLoading(false)
      }
    }

    void refreshQueue()
    timeoutId = window.setInterval(refreshQueue, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timeoutId)
    }
  }, [view, recoveryPhase, recoveryQueueAttempt])

  const beginPasswordRecovery = async (event) => {
    event.preventDefault()
    if (recoveryStartRef.current) return
    if (!recoveryRequestId) {
      setRecoveryError('Select a password-recovery request first.')
      return
    }
    recoveryStartRef.current = true
    setRecoveryError('')
    setRecoveryMessage('Contacting the NFC bridge and validating the request…')
    setRecoveryPhase('starting')
    try {
      const handoff = await startPasswordRecovery(recoveryRequestId)
      setRecoveryRequestId(handoff.request_id)
      setRecoveryMessage(handoff.message)
      setRecoveryPhase('waiting')
    } catch (error) {
      setRecoveryPhase('failed')
      setRecoveryMessage('')
      setRecoveryError(error.message || 'Password recovery could not be started.')
    } finally {
      recoveryStartRef.current = false
    }
  }

  const selectQueuedRecovery = (requestId) => {
    setRecoveryRequestId(requestId)
    setRecoveryPhase('idle')
    setRecoveryMessage('')
    setRecoveryError('')
  }

  const cancelRecovery = async () => {
    recoveryAbortControllerRef.current?.abort()
    if (recoveryRequestId && recoveryPhase !== 'confirmed') {
      try {
        await cancelPasswordRecovery(recoveryRequestId)
      } catch (error) {
        setRecoveryError(error.message || 'The NFC bridge could not confirm cancellation.')
      }
    }
    setRecoveryRequestId('')
    setRecoveryPhase('idle')
    setRecoveryMessage('')
  }

  useEffect(() => {
    if (view !== 'password-recovery' || recoveryPhase !== 'waiting' || !recoveryRequestId) return undefined
    let cancelled = false
    let timeoutId
    let pollController
    let retryDelay = RECOVERY_STATUS_POLL_INTERVAL_MS

    const poll = async () => {
      pollController = new AbortController()
      recoveryAbortControllerRef.current = pollController
      try {
        const [backendStatus, bridgeStatus] = await Promise.all([
          fetchPasswordRecoveryStatus(recoveryRequestId, { signal: pollController.signal }),
          fetchPasswordRecoveryBridgeStatus(recoveryRequestId, { signal: pollController.signal }),
        ])
        if (cancelled) return
        retryDelay = RECOVERY_STATUS_POLL_INTERVAL_MS
        const status = backendStatus.status
        if (status === 'verified') {
          setRecoveryPhase('confirmed')
          setRecoveryQueue((currentQueue) => currentQueue.filter(
            (item) => item.request_id !== recoveryRequestId,
          ))
          setRecoveryMessage('Identity verified. You can now create a new password on the TapTrack website.')
          setRecoveryError('')
          return
        }
        if (status === 'expired' || status === 'used' || status === 'cancelled') {
          void cancelPasswordRecovery(recoveryRequestId).catch(() => {})
          setRecoveryPhase(status === 'expired' ? 'expired' : 'failed')
          setRecoveryMessage(`Django reported password-recovery status: ${status}.`)
          return
        }
        if (status !== 'pending') {
          setRecoveryPhase('failed')
          setRecoveryMessage('Django returned an unexpected password-recovery status.')
          return
        }
        if (bridgeStatus.state === 'failed' || bridgeStatus.state === 'expired' || bridgeStatus.state === 'cancelled') {
          setRecoveryPhase(bridgeStatus.state)
          setRecoveryMessage(bridgeStatus.message)
          return
        }
        setRecoveryMessage(`Django reports password-recovery status: ${status}. Tap the registered card when ready.`)
        setRecoveryError('')
      } catch (error) {
        if (!cancelled && !pollController.signal.aborted) {
          setRecoveryError(error.message || 'Unable to check password-recovery status.')
          retryDelay = Math.min(retryDelay * 2, RECOVERY_STATUS_MAX_BACKOFF_MS)
        }
      } finally {
        if (!cancelled && !pollController.signal.aborted) {
          timeoutId = window.setTimeout(poll, retryDelay)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      pollController?.abort()
      if (recoveryAbortControllerRef.current === pollController) recoveryAbortControllerRef.current = null
    }
  }, [view, recoveryPhase, recoveryRequestId])

  useEffect(() => {
    if (view !== 'password-recovery' || recoveryPhase !== 'confirmed') return undefined

    const timeoutId = window.setTimeout(() => {
      setRecoveryRequestId('')
      setRecoveryPhase('idle')
      setRecoveryMessage('')
      setRecoveryError('')
    }, RECOVERY_VERIFIED_MESSAGE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [view, recoveryPhase])

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
        setPendingRegistration(null)
        setRegistrationCountdown(600)
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
            expiresAt: event.expires_at,
            serverTime: event.server_time,
          })
          if (view === 'participant-scan') {
            pauseAfterDecision = true
            setPendingRegistration({
              uid,
              registrationUrl,
              expiresAt: event.expires_at,
              serverTime: event.server_time,
              sessionId: event.session_id,
            })
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
    const intervalId = window.setInterval(() => void pollScanBridge(), SCAN_BRIDGE_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      bridgeAbortControllerRef.current?.abort()
    }
  }, [view, selectedSession, requestScanPhotoCapture])

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
  const bridgeStatusLabel = bridgeConnectionStatus === 'connected'
    ? 'Connected'
    : bridgeConnectionStatus === 'unavailable' ? 'Disconnected' : 'Connecting'
  const bridgeErrorDetail = errorMessage || accessState.message || serviceStatus?.error || ''

  function updateStationSession(session) {
    if (!session) return
    setCabinetState((current) => ({
      sessions: [...current.sessions.filter((item) => item.station !== session.station), session],
    }))
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
      const data = await runWorkflowCommand(() => sendCabinetWorkflow('open', { station }))
      if (!data) return
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
      const data = await runWorkflowCommand(() => sendCabinetWorkflow('start_close', { station }))
      if (!data) return
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
    setErrorMessage('')
    setStatusMessage('Tap NFC cards to record closing attendance.')
    setView('close-scan')
  }

  async function cancelRegistration() {
    const registrationUrl = pendingRegistration?.registrationUrl
    const token = registrationUrl ? new URL(registrationUrl).searchParams.get('token') : null
    if (token) {
      try {
        const cancellation = await cancelEnrollmentRegistration(token)
        if (!cancellation.cancelled) {
          const status = await getEnrollmentStatus(token)
          if (status.status === 'completed') {
            setPendingRegistration(null)
            setRegistrationCountdown(600)
            setView('registration-success')
            return
          }
          if (status.status !== 'expired' && status.status !== 'cancelled') {
            setErrorMessage('Registration could not be cancelled. The QR code is still active.')
            return
          }
        }
      } catch (error) {
        setErrorMessage(error.message || 'Registration could not be cancelled. The QR code is still active.')
        return
      }
    }
    setPendingRegistration(null)
    setRegistrationCountdown(600)
    resumeParticipantScan({ skipped: true })
  }

  function resumeParticipantScan({ skipped = false } = {}) {
    setPendingRegistration(null)
    setAccessState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
    setScanFeedback(null)
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
    if (workflowRequestRef.current) return
    if (pendingAction === 'open') {
      if (!selectedStation || !selectedSession || selectedSession.workflow_state !== 'opening') {
        setErrorMessage('Start an opening workflow for the selected station before opening the cabinet.')
        setView('station-select')
        return
      }
      setView('cabinet-opening')
      try {
        const data = await runWorkflowCommand(() => sendCabinetWorkflow('finish_open', { station: selectedStation }))
        if (!data) {
          setView('confirm-session')
          return
        }
        const session = normalizeServerSession(data.session)
        updateStationSession(session)
        setStatusMessage(`Open workflow completed for ${stationLabel(data.station)}.`)
        setMotorStatusMessage(motorDispatchStatus(data.motor_dispatch, 'finish_open'))
        setView('cabinet-opened')
      } catch (error) {
        setErrorMessage(error.message || 'The cabinet session could not be opened.')
        setView('confirm-session')
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

    setView('cabinet-closing')
    try {
      const data = await runWorkflowCommand(() => sendCabinetWorkflow('finish_close', { station: selectedStation }))
      if (!data) {
        setView('confirm-session')
        return
      }
      const session = normalizeServerSession(data.session)
      updateStationSession(session)
      setClosedSession(session)
      setStatusMessage(`Close workflow completed for ${stationLabel(data.station)}.`)
      setMotorStatusMessage(motorDispatchStatus(data.motor_dispatch, 'finish_close'))
      setView('cabinet-closed')
    } catch (error) {
      setErrorMessage(error.message || 'The cabinet session could not be closed.')
    }
  }

  return (
    <div className="app-root">
      <TapTrackHeader
        title={SCREEN_TITLES[view] || 'TapTrack Cabinet'}
        bridgeStatus={bridgeConnectionStatus}
        bridgeLabel={bridgeStatusLabel}
        clock={<CabinetClock />}
      />
      {view === 'home' && (
        <Screen className="home-screen">
          <div className="home-shell">
            <div className="hero-card cabinet-home-card">
              <div className="title-block">
                <h1 className="title">Cabinet Management</h1>
                <p className="subtitle">Secure, student-verified equipment access.</p>
                {bridgeConnectionStatus === 'unavailable' && bridgeErrorDetail && (
                  <details className="nfc-diagnostics home-diagnostics">
                    <summary>Technical details</summary>
                    <p>{bridgeErrorDetail}</p>
                  </details>
                )}
              </div>
              <div className="station-status-grid" aria-label="Cabinet station status">
                {readerStations.map((station) => {
                  const session = sessions.find((item) => item.status === 'open' && item.station === station)
                  return (
                    <StationCard
                      key={station}
                      label={stationLabel(station)}
                      state={session ? 'occupied' : 'available'}
                      detail={session ? `${getParticipantCount(session)} participants in session` : 'Ready for access'}
                    >
                      {session && <small>Session began {formatSessionTime(session.openedAt)}</small>}
                    </StationCard>
                  )
                })}
              </div>
              <div className="clock-card">
                <span className="clock-label">Current date and time</span>
                <CabinetClock />
              </div>
            </div>

            <div className="home-actions">
              <button className="btn primary home-action" onClick={startOpenSession}>
                <span className="home-action-icon"><KioskIcon name="open" size={25} /></span>
                <span className="home-action-copy"><strong>OPEN CABINET</strong><small>Start a student group session</small></span>
              </button>
              <button className="btn secondary home-action" onClick={startCloseSession}>
                <span className="home-action-icon"><KioskIcon name="close" size={25} /></span>
                <span className="home-action-copy"><strong>CLOSE CABINET</strong><small>Record closing attendance</small></span>
              </button>
              <button className="btn ghost home-action" onClick={() => {
                setRecoveryError('')
                setRecoveryMessage('')
                setRecoveryPhase('idle')
                setView('password-recovery')
              }}>
                <span className="home-action-icon"><KioskIcon name="recovery" size={25} /></span>
                <span className="home-action-copy"><strong>PASSWORD RECOVERY</strong><small>Verify with a registered NFC card</small></span>
              </button>
              <button className="btn ghost home-action" onClick={() => setView('status-screen')}>
                <span className="home-action-icon"><KioskIcon name="status" size={25} /></span>
                <span className="home-action-copy"><strong>CABINET STATUS</strong><small>Check reader and session state</small></span>
              </button>
            </div>
            {errorMessage && bridgeConnectionStatus !== 'unavailable' && <div className="error-banner home-error" role="alert">{errorMessage}</div>}
          </div>
        </Screen>
      )}

      {view === 'password-recovery' && (
        <Screen>
          <div className="panel recovery-panel">
            <h2>Password Recovery</h2>
            <p className="muted">
              Choose the student request. The next card tapped is checked only against that account.
            </p>
            {recoveryQueue.length > 0 && (
              <div className="recovery-queue" aria-label="Pending password recovery requests">
                {recoveryQueue.map((item) => (
                  <button
                    className={`recovery-request ${recoveryRequestId === item.request_id ? 'is-selected' : ''}`}
                    type="button"
                    key={item.request_id}
                    onClick={() => selectQueuedRecovery(item.request_id)}
                    disabled={['starting', 'waiting', 'confirmed'].includes(recoveryPhase)}
                  >
                    <span>
                      <strong>{item.display_name}</strong>
                      <small>{item.account_reference} · {item.status}</small>
                    </span>
                    <span aria-hidden="true"><KioskIcon name="back" size={18} /></span>
                  </button>
                ))}
              </div>
            )}
            {recoveryQueueLoading && recoveryQueue.length === 0 && <LoadingIndicator label="Loading pending requests" />}
            {!recoveryQueueLoading && recoveryQueueError && (
              <div className="recovery-empty">
                <ErrorMessage>{recoveryQueueError}</ErrorMessage>
                <button className="btn secondary" type="button" onClick={() => setRecoveryQueueAttempt((attempt) => attempt + 1)}>RETRY</button>
              </div>
            )}
            {!recoveryQueueLoading && !recoveryQueueError && recoveryQueue.length === 0 && (
              <EmptyState title="No pending recovery requests." description="New requests appear here automatically." icon="recovery" />
            )}
            {recoveryPhase !== 'idle' && (
              <NFCScanIndicator
                title={recoveryPhase === 'starting' ? 'Checking selected request'
                  : recoveryPhase === 'waiting' ? 'Waiting for registered card'
                    : recoveryPhase === 'confirmed' ? 'Identity verified'
                      : recoveryPhase === 'expired' ? 'Request expired' : 'Verification not completed'}
                description={recoveryPhase === 'failed' || recoveryPhase === 'expired'
                  ? 'Verification stopped. Review the error below before starting again.'
                  : recoveryMessage || 'The selected student must tap their own registered NFC card.'}
                state={recoveryPhase === 'confirmed' ? 'success' : recoveryPhase === 'failed' || recoveryPhase === 'expired' ? 'error' : 'waiting'}
              />
            )}
            {recoveryPhase === 'idle' || recoveryPhase === 'failed' ? (
              <>
                {recoveryPhase === 'failed' && recoveryMessage && <p className="recovery-status" role="status">{recoveryMessage}</p>}
                <form className="recovery-form" onSubmit={beginPasswordRecovery}>
                  <button className="btn primary" type="submit" disabled={recoveryPhase === 'starting' || !recoveryRequestId || recoveryQueueLoading}>
                    {recoveryPhase === 'starting' ? 'CHECKING REQUEST…' : 'START NFC RECOVERY'}
                  </button>
                </form>
              </>
            ) : null}
            {recoveryError && <ErrorMessage>{recoveryError}</ErrorMessage>}
            <div className="button-row">
              {recoveryPhase === 'waiting' || recoveryPhase === 'starting'
                ? <button className="btn secondary" type="button" onClick={cancelRecovery} disabled={recoveryPhase === 'starting'}>CANCEL RECOVERY</button>
                : <button className="btn ghost" type="button" onClick={async () => {
                  if (recoveryRequestId) await cancelRecovery()
                  else {
                    setRecoveryPhase('idle')
                    setRecoveryMessage('')
                    setRecoveryError('')
                  }
                  setView('home')
                }}>BACK TO HOME</button>}
            </div>
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
            <WorkflowProgress steps={['Select station', 'Closing attendance', 'Confirm']} activeIndex={1} />
            <div className="large-state is-open"><StatusBadge state="warning"><span className="status-indicator" />ACTIVE SESSION</StatusBadge></div>
            <h2>Close {stationLabel(selectedStation)}</h2>
            <NFCScanIndicator
              compact
              title="Record closing attendance"
              description="Only members of this active session can be added."
              state={scanFeedback?.type === 'success' ? 'success' : scanFeedback?.type === 'warning' ? 'error' : 'waiting'}
            />
            <div className="status-chip">
              <span className={`status-dot ${scanFeedback?.type === 'success' ? 'good' : scanFeedback?.type === 'duplicate' ? 'warning-dot' : 'good'}`} />
              <span>{statusMessage || 'Tap NFC cards to record closing attendance.'}</span>
            </div>
            <div className="confirm-list">
              <div className="confirm-row"><span>Session Status</span><strong>ACTIVE</strong></div>
              <div className="confirm-row"><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div className="confirm-row"><span>Closed by</span><strong>{closingParticipants.length}</strong></div>
              <div className="confirm-row"><span>Opened</span><strong>{formatSessionTime(selectedSession?.openedAt)}</strong></div>
            </div>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(selectedSession?.opened_by || []).map((participant, index) => (
                <ParticipantCard key={participant.uid || participant.studentId} participant={participant} index={index} />
              ))}
            </div>
            <div className="participant-list session-participants">
              <h3>Closed by</h3>
              {closingParticipants.length === 0
                ? <EmptyState title="No closing attendance yet" description="Tap a member's registered card to record attendance." />
                : closingParticipants.map((participant, index) => (
                  <ParticipantCard key={participant.uid || participant.studentId} participant={participant} index={index} />
                ))}
            </div>
            <ErrorMessage>{errorMessage}</ErrorMessage>
            <div className="scan-prompt" role="status">Keep hands and objects away from the moving cabinet. Physical movement is not reported as verified.</div>
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
            <div className="large-state is-closed"><StatusBadge state="warning"><span className="status-indicator" />NOT AUTHORIZED</StatusBadge></div>
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
            <div className="large-state is-closed"><StatusBadge state="success"><span className="status-indicator" />NO ACTIVE SESSION</StatusBadge></div>
            <h2>{selectedStation ? `${stationLabel(selectedStation)} is already closed.` : 'Cabinet is already closed.'}</h2>
            <div className="button-row">
              <button className="btn primary" onClick={resetToHome}>BACK TO HOME</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'unregistered-card' && (
        <Screen>
          <div className="panel status-panel registration-panel">
            <div className="large-state is-open"><StatusBadge state="warning"><span className="status-indicator" />ID CARD NOT REGISTERED</StatusBadge></div>
            <h2>Register Your ID Card</h2>
            <p className="muted">Scan the QR code with your phone to begin registration.</p>
            <SessionSummary rows={[{ label: 'Participants already scanned', value: participants.length }]} />
            {participants.length > 0 && (
              <div className="participant-list session-participants">
                {participants.map((participant, index) => (
                  <ParticipantCard key={participant.uid || participant.studentId} participant={participant} index={index} />
                ))}
              </div>
            )}
            {pendingRegistration?.registrationUrl && (
              <>
                <div className="registration-qr">
                  <QRCodeSVG value={pendingRegistration.registrationUrl} size={280} bgColor="#ffffff" fgColor="#002B5B" level="M" />
                </div>
                <p className="muted" role="timer">QR Code Expires In: {formatCountdown(registrationCountdown)}</p>
              </>
            )}
            {errorMessage && <div className="error-banner" role="alert">{errorMessage}</div>}
            <div className="button-row stacked">
              <button className="btn secondary" type="button" onClick={cancelRegistration}>Cancel Registration</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'registration-expired' && (
        <Screen>
          <div className="panel status-panel">
            <StatusBadge state="warning"><span className="status-indicator" />REGISTRATION EXPIRED</StatusBadge>
            <h2>Registration Expired</h2>
            <p className="muted">Your registration session has expired. Tap your ID card again to start a new session.</p>
            <div className="button-row">
              <button className="btn primary" type="button" onClick={resetToHome}>Back to Card Tapping</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'registration-success' && (
        <Screen>
          <div className="panel status-panel">
            <div className="success-badge"><KioskIcon name="check" size={28} /></div>
            <StatusBadge state="success"><span className="status-indicator" />REGISTRATION COMPLETE</StatusBadge>
            <h2>ID Card Registered</h2>
            <p className="muted">Registration complete. Tap your ID card again to continue.</p>
            <div className="button-row">
              <button className="btn primary" type="button" onClick={resetToHome}>Back to Card Tapping</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'station-select' && (
        <Screen>
          <div className="panel">
            <h2>Select Station</h2>
            {!workflowLoaded && <LoadingIndicator label="Loading configured stations" />}
            {workflowLoaded && readerStations.length === 0 && (
              <EmptyState title="No stations are configured" description="Check the Cabinet station configuration." />
            )}
            <div className="station-grid">
              {readerStations.map((station) => {
                const session = sessions.find((item) => item.status === 'open' && item.station === station)
                const resuming = session?.workflow_state === 'opening'
                return (
                  <StationCard
                    key={station}
                    label={stationLabel(station)}
                    state={session ? resuming ? 'busy' : 'occupied' : 'available'}
                    detail={resuming ? 'An opening session can be resumed.' : session ? 'An active session is using this station.' : 'Ready to begin a group session.'}
                    onClick={() => handleStationSelect(station)}
                    disabled={workflowBusy || Boolean(session && !resuming)}
                  >
                    <span className="station-card-action">{workflowBusy ? 'PLEASE WAIT…' : resuming ? 'RESUME OPENING' : session ? 'IN USE' : 'SELECT STATION'}</span>
                  </StationCard>
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
            {!occupiedStations.length && <EmptyState title="All stations are available" description="There are no active cabinet sessions to close." />}
            <div className="station-grid">
              {readerStations.map((station) => {
                const session = sessions.find((item) => item.status === 'open' && item.station === station)
                const inProgress = session?.workflow_state === 'opening' || session?.workflow_state === 'closing'
                return (
                  <StationCard
                    key={station}
                    label={stationLabel(station)}
                    state={!session ? 'available' : inProgress ? 'busy' : 'occupied'}
                    detail={session
                      ? `${getParticipantCount(session)} participants · opened ${formatSessionTime(session.openedAt)}`
                      : 'No active session'}
                  >
                    <button
                      className={`btn ${session ? 'primary' : 'ghost'} close-station-action`}
                      onClick={() => session?.workflow_state === 'opening'
                        ? resumeOpeningSession(session)
                        : session ? selectSessionToClose(station) : undefined}
                      disabled={workflowBusy || !session}
                    >
                      {!session ? 'NO ACTIVE SESSION'
                        : session.workflow_state === 'opening' ? workflowBusy ? 'PLEASE WAIT…' : 'RESUME OPENING'
                          : session.workflow_state === 'closing' ? workflowBusy ? 'PLEASE WAIT…' : 'CONTINUE CLOSING'
                            : workflowBusy ? 'PLEASE WAIT…' : `CLOSE ${stationLabel(station).toUpperCase()}`}
                    </button>
                  </StationCard>
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
            <WorkflowProgress steps={['Select station', 'Opening attendance', 'Confirm']} activeIndex={1} />
            <div className="scan-hero">
              <NFCScanIndicator
                title={scanFeedback?.type === 'success' ? 'Card recorded' : scanFeedback?.type === 'warning' ? 'Card needs attention' : 'Tap Your ID Card'}
                description={`Hold a registered student card near the reader for ${stationLabel(selectedStation)}.`}
                state={scanFeedback?.type === 'success' ? 'success' : scanFeedback?.type === 'warning' || scanFeedback?.type === 'bridge-error' ? 'error' : 'waiting'}
              />
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
            <ErrorMessage>{errorMessage}</ErrorMessage>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Participants</h3>
                <span>Participants scanned: {participants.length}</span>
              </div>
              <div className="participant-list">
                {participants.length === 0 ? (
                  <EmptyState title="No participants added yet" description="Tap each group member's registered NFC card to record attendance." />
                ) : (
                  participants.map((participant, index) => (
                    <ParticipantCard key={`${participant.uid}-${index}`} participant={participant} index={index} />
                  ))
                )}
              </div>
            </div>

            <div className="button-row stacked">
              <div className="scan-prompt" role="status">Hold your registered ID card near the reader.</div>
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
            <WorkflowProgress
              steps={pendingAction === 'open' ? ['Select station', 'Opening attendance', 'Confirm'] : ['Select station', 'Closing attendance', 'Confirm']}
              activeIndex={2}
            />
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
                  <div className="confirm-row"><span>Current duration</span><strong><SessionDuration startedAt={selectedSession?.openedAt} /></strong></div>
                </>
              )}
            </div>
            <div className="participant-list">
              {(pendingAction === 'open' ? participants : closingParticipants).map((participant, index) => (
                <ParticipantCard key={`${participant.uid}-${index}`} participant={participant} index={index} />
              ))}
            </div>
            <ErrorMessage>{errorMessage}</ErrorMessage>
            <div className="button-row">
              {pendingAction === 'open'
                ? <button className="btn ghost" onClick={() => setView('participant-scan')}>BACK</button>
                : <button className="btn ghost" onClick={() => setView('close-scan')}>BACK TO CARD TAPPING</button>}
              <button className="btn primary" onClick={finalizeSession} disabled={workflowBusy}>{workflowBusy ? pendingAction === 'open' ? 'OPENING…' : 'CLOSING…' : pendingAction === 'open' ? 'OPEN CABINET' : `CLOSE ${stationLabel(selectedStation).toUpperCase()}`}</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-opening' && (
        <Screen>
          <div className="panel status-panel">
            <WorkflowProgress steps={['Select station', 'Opening attendance', 'Confirm']} activeIndex={2} />
            <div className="large-state is-open"><StatusBadge state="warning"><span className="status-indicator" />Opening</StatusBadge></div>
            <h2>Opening Cabinet — Please Wait</h2>
            <CabinetAnimation direction="opening" active />
            <p className="muted">Selected station: <strong>{String(selectedStation || '').toUpperCase()}</strong></p>
            <LoadingIndicator label="Communicating with the cabinet controller" />
            <ErrorMessage>{motorStatusMessage}</ErrorMessage>
            <p className="safety-note">This animation is visual only. Physical shutter movement is not verified by animation alone.</p>
          </div>
        </Screen>
      )}

      {view === 'cabinet-closing' && (
        <Screen>
          <div className="panel status-panel">
            <WorkflowProgress steps={['Select station', 'Closing attendance', 'Confirm']} activeIndex={2} />
            <div className="large-state is-open"><StatusBadge state="warning"><span className="status-indicator" />Closing</StatusBadge></div>
            <h2>Closing Cabinet — Please Wait</h2>
            <CabinetAnimation direction="closing" active />
            <p className="muted">Selected station: <strong>{String(selectedStation || '').toUpperCase()}</strong></p>
            <LoadingIndicator label="Recording the closing workflow" />
            <div className="safety-note"><strong>Keep hands and objects away from the moving cabinet.</strong></div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-opened' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="success-badge"><KioskIcon name="check" size={28} /></div>
            <div className="large-state is-open"><span className="status-dot warning-dot" /><strong>OPEN WORKFLOW RECORDED</strong></div>
            <h2>Open Workflow Complete</h2>
            <p className="muted" role="status">{statusMessage}</p>
            <p className="muted" role="status">{motorStatusMessage}</p>
            <div className="truthful-status"><strong>Physical cabinet status: Not verified</strong><p>Motor feedback does not confirm that the shutter reached a verified position.</p></div>
            <p className="muted">Physical shutter movement was not verified.</p>
            <div className="session-metrics">
              <div><span>Station</span><strong>{selectedSession?.station}</strong></div>
              <div><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div><span>Session Duration</span><strong><SessionDuration startedAt={selectedSession?.openedAt} /></strong></div>
            </div>
            <p className="session-id">Session {selectedSession?.id || 'active'}</p>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(selectedSession?.opened_by || []).map((participant, index) => (
                <ParticipantCard key={participant.uid || participant.studentId} participant={participant} index={index} />
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
            <p className="muted" role="status">{statusMessage}</p>
            <p className="muted" role="status">{motorStatusMessage}</p>
            <div className="truthful-status"><strong>Software workflow: Closed</strong><p>Physical shutter movement is not verified unless controller telemetry confirms it.</p></div>
            <p className="muted">Physical shutter movement was not verified.</p>
            <div className="session-metrics">
              <div><span>Opened by</span><strong>{getParticipantCount(closedSession)}</strong></div>
              <div><span>Closed by</span><strong>{closedSession?.closed_by?.length || 0}</strong></div>
              <div><span>Session Duration</span><strong>{formatDuration(closedSession?.openedAt, closedSession?.closedAt)}</strong></div>
            </div>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(closedSession?.opened_by || []).map((student, index) => (
                <ParticipantCard key={student.uid || student.studentId} participant={student} index={index} />
              ))}
            </div>
            <div className="participant-list session-participants">
              <h3>Closed by</h3>
              {(closedSession?.closed_by || []).map((student, index) => (
                <ParticipantCard key={student.uid || student.studentId} participant={student} index={index} />
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
          <div className="panel status-panel">
            <h2>Cabinet Status</h2>
            <p className="muted">Current cabinet state and session history.</p>
            {serviceStatus && (
              <div className="status-card" role="status">
                <strong>NFC bridge: {serviceStatus.service === 'ready' ? 'Connected' : 'Disconnected'}</strong>
                {serviceStatus.reader_connected !== undefined && (
                  <p>Physical NFC reader: {serviceStatus.reader_connected ? 'Connected' : 'Waiting for reader'}</p>
                )}
                {serviceStatus.error && <details className="nfc-diagnostics">
                  <summary>Technical details</summary>
                  <p>{serviceStatus.error}</p>
                </details>}
              </div>
            )}
            <div className="status-list">
              {sessions.length === 0 ? (
                <EmptyState title="No sessions recorded yet" description="Active cabinet sessions will appear here." />
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
