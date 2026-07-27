import { useEffect, useMemo, useState } from 'react'
import './App.css'

const USERS_STORAGE_KEY = 'cabinet_users'
const SESSIONS_STORAGE_KEY = 'cabinet_sessions'
const ATTENDANCE_STORAGE_KEY = 'cabinet_attendance'
const DEFAULT_REGISTRATION_ROLE = 'student'

const DEMO_USERS = {
  'CARD-ALINA-001': {
    fullName: 'Alina Reyes',
    studentId: '20240021',
    section: 'BSIT-201',
    role: 'student',
  },
  'CARD-BEN-002': {
    fullName: 'Ben Morales',
    studentId: '20240022',
    section: 'BSIT-202',
    role: 'student',
  },
  'CARD-CLARA-003': {
    fullName: 'Clara Bautista',
    studentId: '20240023',
    section: 'BSIT-201',
    role: 'student',
  },
  'CARD-DAN-004': {
    fullName: 'Daniel Park',
    studentId: '20240024',
    section: 'BSIT-202',
    role: 'student',
  },
  'CARD-ELA-005': {
    fullName: 'Elaine Cruz',
    studentId: '20240025',
    section: 'BSIT-203',
    role: 'student',
  },
  'CARD-FRAN-006': {
    fullName: 'Franco Dela Rosa',
    studentId: '20240026',
    section: 'BSIT-201',
    role: 'student',
  },
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

function loadStoredUsers() {
  try {
    const stored = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '{}')
    if (Object.keys(stored).length > 0) {
      return stored
    }
  } catch (error) {
    console.warn('Unable to load stored cabinet users.', error)
  }

  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(DEMO_USERS))
  return { ...DEMO_USERS }
}

function loadStoredSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_STORAGE_KEY) || '[]')
  } catch (error) {
    console.warn('Unable to load stored sessions.', error)
    return []
  }
}

function loadStoredAttendance() {
  try {
    return JSON.parse(localStorage.getItem(ATTENDANCE_STORAGE_KEY) || '[]')
  } catch (error) {
    console.warn('Unable to load stored attendance records.', error)
    return []
  }
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
  const [users, setUsers] = useState(() => loadStoredUsers())
  const [sessions, setSessions] = useState(() => loadStoredSessions())
  const [attendanceRecords, setAttendanceRecords] = useState(() => loadStoredAttendance())
  const [scanSequenceIndex, setScanSequenceIndex] = useState(0)
  const [activeSession, setActiveSession] = useState(null)
  const [form, setForm] = useState({ fullName: '', studentId: '', section: '' })
  const [nfcUid, setNfcUid] = useState('')

  useEffect(() => {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
  }, [users])

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(attendanceRecords))
  }, [attendanceRecords])

  useEffect(() => {
    const intervalId = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  const occupiedStations = useMemo(() => {
    return sessions
      .filter((session) => session.status === 'open')
      .map((session) => session.station)
  }, [sessions])

  const registeredStudentUids = useMemo(() => {
    return Object.keys(users).filter((uid) => {
      const user = users[uid]
      return user && String(user.role || DEFAULT_REGISTRATION_ROLE).toLowerCase() === 'student'
    })
  }, [users])

  function resetToHome() {
    setView('home')
    setPendingAction('open')
    setSelectedStation(null)
    setParticipants([])
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage('Ready for the next cabinet session.')
    setNfcUid('')
    setScanSequenceIndex(0)
  }

  function beginSession(action) {
    setPendingAction(action)
    setParticipants([])
    setSelectedStation(null)
    setScanFeedback(null)
    setErrorMessage('')
    setStatusMessage(action === 'open'
      ? 'Choose a station and begin scanning participants.'
      : 'Choose the station and scan the returning participants.')
    setView('station-select')
  }

  function startOpenSession() {
    beginSession('open')
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

  function handleCardScan(simulatedUid = null) {
    const nextUid = simulatedUid || registeredStudentUids[scanSequenceIndex % Math.max(registeredStudentUids.length, 1)]
    setScanSequenceIndex((current) => current + 1)

    if (!nextUid) {
      setErrorMessage('No registered student cards are available for demo scanning yet.')
      return
    }

    const foundUser = users[nextUid]
    if (!foundUser) {
      setErrorMessage('That card is not registered in the cabinet system.')
      setScanFeedback({ type: 'warning', message: 'Card not registered', participant: null })
      setStatusMessage('Use a registered card for the next scan.')
      return
    }

    const normalizedUser = {
      ...foundUser,
      uid: nextUid,
      role: String(foundUser.role || DEFAULT_REGISTRATION_ROLE).toLowerCase(),
    }

    if (normalizedUser.role !== 'student') {
      setErrorMessage('Only student cards can be added to the participant scan.')
      setScanFeedback({ type: 'warning', message: 'Only student cards can join', participant: null })
      setStatusMessage('Use a student card for this session.')
      return
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
      setAttendanceRecords((current) => [
        ...snapshot.map((participant) => ({
          sessionId: sessionRecord.id,
          uid: participant.uid,
          fullName: participant.fullName,
          studentId: participant.studentId,
          section: participant.section,
          checkedInAt: now.toISOString(),
        })),
        ...current,
      ])
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
    setAttendanceRecords((current) => [
      ...snapshot.map((participant) => ({
        sessionId: activeSession.id,
        uid: participant.uid,
        fullName: participant.fullName,
        studentId: participant.studentId,
        section: participant.section,
        checkedInAt: now.toISOString(),
        action: 'close',
      })),
      ...current,
    ])
    setActiveSession(closedSession)
    setStatusMessage(`Cabinet closed on Station ${selectedStation}.`)
    setView('cabinet-closed')
  }

  function handleRegistrationSubmit(event) {
    event.preventDefault()

    if (!nfcUid) {
      setErrorMessage('A tapped card is required before registration can proceed.')
      return
    }

    if (!form.fullName.trim() || !form.studentId.trim() || !form.section.trim()) {
      setErrorMessage('Please complete all registration fields.')
      return
    }

    const newUser = {
      fullName: form.fullName.trim(),
      studentId: form.studentId.trim(),
      section: form.section.trim(),
      role: DEFAULT_REGISTRATION_ROLE,
    }

    setUsers((current) => ({ ...current, [nfcUid]: newUser }))
    setStatusMessage('Card registered successfully.')
    setErrorMessage('')
    setView('registration-success')
  }

  function goToRegistration() {
    setForm({ fullName: '', studentId: '', section: '' })
    setErrorMessage('')
    setView('register-card')
  }

  return (
    <div className="app-root">
      {view === 'home' && (
        <Screen>
          <div className="home-shell">
            <div className="hero-card">
              <div className="nfc-ring">
                <IconNFC pulse />
              </div>
              <div className="title-block">
                <h1 className="title">Cabinet Access</h1>
                <p className="subtitle">A touch-friendly workflow for open-ended NFC participant scanning.</p>
              </div>
              <div className="status-chip">
                <span className="status-dot good" />
                <span>{statusMessage}</span>
              </div>
              <div className="clock-card">
                <span className="clock-label">Cabinet Status</span>
                <strong>Online · Ready</strong>
                <span className="clock-time">{formatDateTime(clock)}</span>
              </div>
            </div>

            <div className="home-actions">
              <button className="btn primary home-action" onClick={startOpenSession}>Tap NFC Card</button>
              <button className="btn secondary home-action" onClick={goToRegistration}>Register Card</button>
              <button className="btn ghost home-action" onClick={() => setView('status-screen')}>Cabinet Status</button>
            </div>
          </div>
        </Screen>
      )}

      {view === 'register-card' && (
        <Screen>
          <div className="panel form-panel">
            <h2>Register Card</h2>
            <p className="muted">Capture the card UID and save a new student profile for the cabinet demo.</p>
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
                <span>Section</span>
                <input value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} placeholder="Enter section" />
              </label>
              {errorMessage && <div className="error-banner">{errorMessage}</div>}
              <div className="button-row">
                <button className="btn primary" type="button" onClick={() => setNfcUid(`CARD-${Math.floor(Math.random() * 9000) + 1000}`)}>Capture Card</button>
                <button className="btn primary" type="submit">Save Card</button>
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
              {[1, 2, 3].map((station) => (
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
            <p className="muted">Recent sessions and station activity.</p>
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
