import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { isSessionMember, recordClosingAttendance } from './services/cabinetAttendance'
import { fetchCabinetWorkflow, fetchScanEvents, sendCabinetWorkflow } from './services/nfc/scanResultBridge'
import './App.css'

const PI_SERVICE_URL = import.meta.env.VITE_PI_SERVICE_URL || 'http://127.0.0.1:8765'
const NFC_MODE = (import.meta.env.VITE_NFC_MODE || (import.meta.env.DEV ? 'mock' : 'hardware')).toLowerCase()
const WEB_APP_BASE_URL = (import.meta.env.VITE_WEB_APP_BASE_URL || '').replace(/\/$/, '')
const REQUEST_TIMEOUT_MS = 15000
const NFC_SCAN_CURSOR_KEY = 'taptrack_cabinet_nfc_scan_cursor'

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
    return `Django rejected the NFC verification request. (HTTP ${response.status})`
  }
  if (!body) return `Django returned an empty response. (HTTP ${response.status})`
  return `Django returned an invalid response. (HTTP ${response.status})`
}

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
  const [closingParticipants, setClosingParticipants] = useState([])
  const [closeRejectedStudent, setCloseRejectedStudent] = useState('')
  const [scanFeedback, setScanFeedback] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Ready for the next cabinet session.')
  const [errorMessage, setErrorMessage] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [cabinetState, setCabinetState] = useState({ sessions: [] })
  const { sessions } = cabinetState
  const [readerContext, setReaderContext] = useState(null)
  const [workflowLoaded, setWorkflowLoaded] = useState(false)
  const selectedSession = sessions.find((session) => session.status === 'open' && session.station === selectedStation) || null
  const [form, setForm] = useState({ fullName: '', studentId: '', email: '', section: '' })
  const [nfcUid, setNfcUid] = useState('')
  const [serviceStatus, setServiceStatus] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState({ display: null, error: '', busy: false })
  const [accessState, setAccessState] = useState({ status: 'idle', name: '', studentId: '', role: '', message: '', registrationUrl: '' })
  const [mockNfcUid, setMockNfcUid] = useState('')
  const nfcScanCursorRef = useRef(loadNfcScanCursor())
  const participantsByUidRef = useRef(new Map())
  const closingParticipantsRef = useRef([])
  const bridgePollingRef = useRef(false)
  const bridgeAbortControllerRef = useRef(null)
  const bridgeErrorRef = useRef('')

  useEffect(() => {
    let cancelled = false
    fetchCabinetWorkflow({ mode: NFC_MODE })
      .then((data) => {
        if (cancelled) return
        const stations = (data.stations || []).map((item) => item.name)
        setReaderContext({
          mode: data.mode || NFC_MODE,
          station: data.station,
          cabinetName: data.cabinet_name,
          stations,
        })
        const sessions = data.mode === 'mock'
          ? data.stations.map((item) => normalizeServerSession(item.session)).filter(Boolean)
          : [normalizeServerSession(data.session)].filter(Boolean)
        setCabinetState({ sessions })
        setWorkflowLoaded(true)
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error.message || 'Unable to load the cabinet session from Django.')
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
    if (NFC_MODE !== 'hardware' || (view !== 'home' && view !== 'participant-scan' && view !== 'close-scan')) return undefined

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
          const registrationUrl = buildRegistrationUrl(event.registration_url)
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
          const message = error.message || 'NFC reader unavailable. Retrying connection.'
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
  }, [view, selectedSession])

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
  const readerStations = readerContext?.mode === 'mock'
    ? readerContext.stations || []
    : readerContext?.station ? [readerContext.station] : []

  function resetToHome() {
    if (selectedSession && selectedSession.workflow_state !== 'idle') {
      void sendCabinetWorkflow('cancel', { mode: NFC_MODE, station: selectedStation }).then((data) => {
        if (data.mode === 'mock') {
          return fetchCabinetWorkflow({ mode: NFC_MODE }).then((state) => {
            setCabinetState({ sessions: state.stations.map((item) => normalizeServerSession(item.session)).filter(Boolean) })
          })
        }
        const session = normalizeServerSession(data.session)
        setCabinetState({ sessions: session ? [session] : [] })
      }).catch((error) => setErrorMessage(error.message || 'The active cabinet workflow could not be cancelled.'))
    }
    setView('home')
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
    setStatusMessage('Ready for the next cabinet session.')
    setNfcUid('')
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
    if (NFC_MODE === 'hardware') {
      if (readerContext?.station) void handleStationSelect(readerContext.station)
      else setErrorMessage('The NFC reader station is not configured.')
      return
    }
    setStatusMessage(NFC_MODE === 'mock' ? 'Choose an available mock station to begin.' : 'The physical reader has no station assignment.')
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
    if (NFC_MODE === 'hardware') {
      if (readerContext?.station) void selectSessionToClose(readerContext.station)
      else setErrorMessage('The NFC reader station is not configured.')
      return
    }
    setStatusMessage('Choose an active mock station to close.')
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
    if (NFC_MODE === 'hardware' && (!readerContext?.station || station !== readerContext.station)) {
      setErrorMessage('This cabinet reader is not assigned to that station.')
      return
    }

    try {
      if (!workflowLoaded) throw new Error('Loading configured stations...')
      const data = await sendCabinetWorkflow('open', { mode: NFC_MODE, station })
      const session = normalizeServerSession(data.session)
      setCabinetState({ sessions: NFC_MODE === 'mock' ? [...sessions, session].filter(Boolean) : [session].filter(Boolean) })
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
    if (!activeSession) return
    if (activeSession.workflow_state === 'opening') {
      resumeOpeningSession(activeSession)
      return
    }
    try {
      const data = await sendCabinetWorkflow('start_close', { mode: NFC_MODE, station })
      const session = normalizeServerSession(data.session)
      setCabinetState({ sessions: sessions.map((item) => item.station === station ? session : item).filter(Boolean) })
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

  function recordClosingParticipant(participant) {
    const result = recordClosingAttendance(selectedSession, closingParticipantsRef.current, participant)
    if (result.status === 'rejected') return false
    if (result.status === 'duplicate') {
      setScanFeedback({ type: 'duplicate', message: 'Already scanned for closing', participant: result.participant })
      setStatusMessage(`${result.participant.fullName || 'This member'} is already in closing attendance.`)
      return true
    }

    const nextParticipants = result.attendance
    closingParticipantsRef.current = nextParticipants
    setClosingParticipants(nextParticipants)
    setScanFeedback({ type: 'success', message: 'Closing attendance recorded', participant })
    setStatusMessage(`${participant.fullName || 'Member'} added to closing attendance (${nextParticipants.length}).`)
    setAccessState({ status: 'success', name: participant.fullName || '', studentId: participant.studentId || '', role: 'student', message: '' })
    return true
  }

  function rejectCloseAttempt(student = 'Unknown NFC card') {
    setCloseRejectedStudent(student)
    setErrorMessage('')
    setView('close-not-authorized')
  }

  function retryCloseScan() {
    setCloseRejectedStudent('')
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage('Tap NFC cards to record closing attendance.')
    setMockNfcUid('')
    setView('close-scan')
  }

  function showUnregisteredCard(uid, url) {
    const registrationUrl = buildRegistrationUrl(url)
    setPendingRegistration({ uid, registrationUrl })
    setAccessState({ status: 'registration', name: '', studentId: '', role: '', message: 'Please scan this QR code to register your card.', registrationUrl })
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage('This NFC card is not linked to a student.')
    setView('unregistered-card')
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

  async function handleCardScan(uidOverride) {
    const openingScan = view === 'participant-scan' && pendingAction === 'open'
    const closingScan = view === 'close-scan' && pendingAction === 'close'
    if (NFC_MODE !== 'mock' || (!openingScan && !closingScan)) return
    setErrorMessage('')
    setStatusMessage('Waiting for the mock NFC service to verify the card...')

    try {
      const mockUid = String(uidOverride ?? mockNfcUid ?? '').trim()
      setMockNfcUid('')
      let data
      let scanUid
      if (mockUid) {
        const response = await fetchWithTimeout('/api/verify-nfc/', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-TapTrack-Mock-Mode': 'true',
          },
          body: JSON.stringify({ nfc_uid: mockUid, station: selectedStation }),
        })
        const result = await readApiResponse(response)
        data = result.data
        if (response.status === 404 && data.registration_required && data.registration_url) {
          if (closingScan) rejectCloseAttempt('Unknown NFC card')
          else showUnregisteredCard(mockUid, data.registration_url)
          return
        }
        if (!response.ok || !data.success) {
          throw new Error(getApiErrorMessage(response, data, result.body))
        }
        scanUid = mockUid
      } else {
        const response = await fetch(`${PI_SERVICE_URL}/cabinet/mock-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        data = await response.json()
        if (!response.ok || !data.success) {
          if (data.registration_required && data.registration_url) {
            if (closingScan) rejectCloseAttempt('Unknown NFC card')
            else showUnregisteredCard('', data.registration_url)
            return
          }
          throw new Error(data.error || 'NFC verification failed.')
        }
        scanUid = data.student_id || data.name
      }

      const nextUid = scanUid || data.student_id || data.name
      const normalizedUser = {
        uid: nextUid,
        fullName: data.name || 'Verified student',
        studentId: data.student_id || 'Student ID unavailable',
        section: '',
      }

      if (String(data.role || '').trim().toLowerCase() !== 'student') {
        if (closingScan) {
          rejectCloseAttempt(normalizedUser.fullName || 'Unknown NFC card')
          return
        }
        setScanFeedback({ type: 'warning', message: 'Only student cards can join', participant: null })
        setStatusMessage('Use a student card for this group.')
        return
      }

      if (closingScan) {
        if (isActiveSessionMember(nextUid, normalizedUser.studentId)) {
          recordClosingParticipant(normalizedUser)
          setCloseRejectedStudent('')
          setErrorMessage('')
        } else {
          rejectCloseAttempt(normalizedUser.fullName || normalizedUser.studentId)
        }
        return
      }

      const alreadyAdded = participantsByUidRef.current.has(nextUid)
        || participants.some((participant) => participant.uid === nextUid)
      if (alreadyAdded) {
        setScanFeedback({ type: 'duplicate', message: 'Already scanned', participant: normalizedUser })
        setErrorMessage('')
        setStatusMessage(`${normalizedUser.fullName} is already in this session.`)
        return
      }

    const newParticipant = {
      uid: nextUid,
      fullName: normalizedUser.fullName,
      studentId: normalizedUser.studentId,
      section: normalizedUser.section,
    }

    participantsByUidRef.current.set(nextUid, newParticipant)
    setParticipants((current) => [...current, newParticipant])
    setAccessState({ status: 'success', name: normalizedUser.fullName, studentId: normalizedUser.studentId, role: data.role, message: '' })
    setScanFeedback({ type: 'success', message: 'Participant added', participant: newParticipant })
    setErrorMessage('')
    setStatusMessage('Participant added successfully.')
    } catch (error) {
      if (closingScan) {
        rejectCloseAttempt('Unknown or unverified NFC card')
        return
      }
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
        setErrorMessage('Start an opening workflow on this reader before opening the cabinet.')
        setView('station-select')
        return
      }
      try {
        const data = await sendCabinetWorkflow('finish_open', { mode: NFC_MODE, station: selectedStation })
        const session = normalizeServerSession(data.session)
        setCabinetState((current) => ({
          sessions: NFC_MODE === 'mock'
            ? current.sessions.map((item) => item.station === data.station ? session : item)
            : [session].filter(Boolean),
        }))
        setStatusMessage(`Cabinet opened on ${stationLabel(data.station)}.`)
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
      const data = await sendCabinetWorkflow('finish_close', { mode: NFC_MODE, station: selectedStation })
      const session = normalizeServerSession(data.session)
      setCabinetState((current) => ({
        sessions: NFC_MODE === 'mock'
          ? current.sessions.map((item) => item.station === data.station ? session : item)
          : [session].filter(Boolean),
      }))
      setStatusMessage(`Cabinet closed on ${stationLabel(data.station)}.`)
      setView('cabinet-closed')
    } catch (error) {
      setErrorMessage(error.message || 'The cabinet session could not be closed.')
    }
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
            <div className="hero-card cabinet-home-card">
              <img className="brand-wordmark" src="/logo1.png" alt="TapTrack" />
              <div className="title-block">
                <h1 className="title">Cabinet Management</h1>
              </div>
              <div className="station-status-grid" aria-label="Cabinet station status">
                {readerStations.map((station) => {
                  const session = sessions.find((item) => item.status === 'open' && item.station === station)
                  return (
                    <div className={`station-status-card ${session ? 'is-open' : 'is-available'}`} key={station}>
                      <strong>{stationLabel(station).toUpperCase()}</strong>
                      <span className="station-status-label"><span className={`status-dot ${session ? 'warning-dot' : 'good'}`} />{session ? 'OPEN' : 'AVAILABLE'}</span>
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
              {NFC_MODE === 'mock' && <button className="btn ghost home-action" onClick={startPasswordRecovery}>Password Recovery</button>}
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
            {NFC_MODE === 'mock'
              ? <form className="mock-nfc-form participant-mock-form" onSubmit={(event) => { event.preventDefault(); void handleCardScan() }}>
                <label htmlFor="close-mock-nfc-uid">Mock NFC UID</label>
                <div className="mock-nfc-controls">
                  <input id="close-mock-nfc-uid" value={mockNfcUid} onChange={(event) => setMockNfcUid(event.target.value)} placeholder="Enter a session member's UID" autoComplete="off" />
                  <button className="btn primary" type="submit">CHECK NFC</button>
                </div>
              </form>
              : <div className="scan-prompt" role="status">Tap member NFC cards on the NFC reader to record closing attendance.</div>}
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
            <h2>Cabinet is already closed.</h2>
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
              <a className="btn primary registration-link" href={pendingRegistration?.registrationUrl || '#'} target="_blank" rel="noopener noreferrer">REGISTER THIS CARD</a>
              <button className="btn secondary" onClick={() => resumeParticipantScan({ skipped: true })}>SKIP FOR NOW</button>
              <button className="btn ghost" onClick={() => resumeParticipantScan()}>BACK TO SCANNING</button>
            </div>
          </div>
        </Screen>
      )}

      {NFC_MODE === 'mock' && view === 'password-recovery' && (
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

      {NFC_MODE === 'mock' && view === 'register-card' && (
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
            <h2>Select Station</h2>
            {!workflowLoaded && <div className="empty-state" role="status">Loading configured stations...</div>}
            {workflowLoaded && readerStations.length === 0 && (
              <div className="empty-state" role="status">No mock stations are configured.</div>
            )}
            <div className="station-grid">
              {readerStations.map((station) => (
                <button
                  key={station}
                  className="btn station-button"
                  disabled={occupiedStations.includes(station)}
                  onClick={() => handleStationSelect(station)}
                >
                  <span>{stationLabel(station).toUpperCase()}</span>
                  <small>{occupiedStations.includes(station) ? 'OCCUPIED' : 'AVAILABLE'}</small>
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
                    <span className="station-status-label"><span className={`status-dot ${session ? 'warning-dot' : 'good'}`} />{session ? 'OPEN' : 'AVAILABLE'}</span>
                    {session ? <>
                      <span>Opened by {getParticipantCount(session)}</span>
                      <small>Opened {formatSessionTime(session.openedAt)}</small>
                      <button
                        className="btn primary"
                        onClick={() => session.workflow_state === 'opening'
                          ? resumeOpeningSession(session)
                          : selectSessionToClose(station)}
                      >
                        {session.workflow_state === 'opening' ? 'RESUME OPENING' : `CLOSE ${stationLabel(station).toUpperCase()}`}
                      </button>
                    </> : <span>No active session</span>}
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
              {NFC_MODE === 'mock'
                ? <>
                  <form className="mock-nfc-form participant-mock-form" onSubmit={(event) => { event.preventDefault(); void handleCardScan() }}>
                    <label htmlFor="participant-mock-nfc-uid">Mock NFC UID</label>
                    <div className="mock-nfc-controls">
                      <input id="participant-mock-nfc-uid" value={mockNfcUid} onChange={(event) => setMockNfcUid(event.target.value)} placeholder="Enter a student UID" autoComplete="off" />
                      <button className="btn primary" type="submit">CHECK NFC</button>
                    </div>
                  </form>
                  <button className="btn secondary scan-action" onClick={() => { setMockNfcUid(''); void handleCardScan('') }}>Use Pi mock reader</button>
                </>
                : <div className="scan-prompt" role="status">Tap a student NFC card on the NFC reader…</div>}
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
            <div className="large-state is-open"><span className="status-dot warning-dot" /><strong>CABINET OPEN</strong></div>
            <h2>Cabinet Open</h2>
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
              <button className="btn primary" onClick={startCloseSession}>CLOSE CABINET</button>
              <button className="btn ghost" onClick={resetToHome}>BACK TO HOME</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'cabinet-closed' && (
        <Screen>
          <div className="panel status-panel success-panel">
            <div className="large-state is-closed"><span className="status-dot good" /><strong>CABINET CLOSED</strong></div>
            <h2>Cabinet Closed</h2>
            <p className="muted">{stationLabel(selectedStation)} is closed.</p>
            <div className="session-metrics">
              <div><span>Opened by</span><strong>{getParticipantCount(selectedSession)}</strong></div>
              <div><span>Closed by</span><strong>{selectedSession?.closed_by?.length || 0}</strong></div>
              <div><span>Session Duration</span><strong>{formatDuration(selectedSession?.openedAt, selectedSession?.closedAt)}</strong></div>
            </div>
            <div className="participant-list session-participants">
              <h3>Opened by</h3>
              {(selectedSession?.opened_by || []).map((student) => (
                <div key={student.uid || student.studentId} className="participant-card">
                  <div className="participant-badge">✓</div>
                  <div><strong>{student.fullName}</strong><p>{student.studentId}</p></div>
                </div>
              ))}
            </div>
            <div className="participant-list session-participants">
              <h3>Closed by</h3>
              {(selectedSession?.closed_by || []).map((student) => (
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
            <p className="muted">{NFC_MODE === 'mock' ? 'Local cabinet session history.' : 'Current cabinet state and session history.'}</p>
            {NFC_MODE === 'mock' && serviceStatus && (
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
