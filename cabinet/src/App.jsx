import { useState, useEffect } from 'react'
import './App.css'

function IconNFC({ className = 'icon-lg' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="#29d0ff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="14" opacity="0.08" fill="#04202a" />
        <path d="M40 32c0-4.4-3.6-8-8-8" />
        <path d="M44 32c0-7-5.4-12.6-12-12.6" />
        <path d="M48 32c0-9.7-7.5-17.6-16.8-17.6" />
      </g>
    </svg>
  )
}

function IconLock({ open = false, className = 'icon-sm' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g fill="none" stroke={open ? '#7efc8d' : '#9db6c8'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="10" width="18" height="11" rx="2" />
        {open ? (
          <path d="M7 10V7a5 5 0 0110 0v3" />
        ) : (
          <path d="M7 10V8a5 5 0 0110 0v2" />
        )}
      </g>
    </svg>
  )
}

function Screen({ children }) {
  return <div className="screen">{children}</div>
}

export default function App() {
  const [screen, setScreen] = useState('welcome')
  const [uid, setUid] = useState(null)
  const [users, setUsers] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cabinet_users') || '{}')
    } catch (e) {
      return {}
    }
  })
  const [form, setForm] = useState({ name: '', section: '', studentId: '' })
  const [selectedStation, setSelectedStation] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [lockerStates, setLockerStates] = useState({ 1: false, 2: false })

  useEffect(() => {
    localStorage.setItem('cabinet_users', JSON.stringify(users))
  }, [users])

  function simulateTap(simUid = null) {
    let newUid = simUid || `UID-${Math.random().toString(36).slice(2, 9)}`
    // Dev: force a registered UID
    if (simUid === 'DEV-REGISTERED') {
      newUid = 'DEV-REGISTERED'
      if (!users[newUid]) {
        const sample = { name: 'Dev Student', section: 'A', studentId: 'DEV001' }
        setUsers((prev) => ({ ...prev, [newUid]: sample }))
      }
      setUid(newUid)
      setStatusMessage('Card recognized')
      // go to station selection next
      setTimeout(() => setScreen('station'), 300)
      return
    }

    // Dev: force an unregistered UID
    if (simUid === 'DEV-UNREGISTERED') {
      newUid = `DEV-UNREG-${Math.random().toString(36).slice(2, 7)}`
      while (users[newUid]) {
        newUid = `DEV-UNREG-${Math.random().toString(36).slice(2, 7)}`
      }
      setUid(newUid)
      // go directly to registration form so user can enter name, etc.
      setTimeout(() => setScreen('register'), 250)
      return
    }

    setUid(newUid)
    if (users[newUid]) {
      setStatusMessage('Card recognized')
      setTimeout(() => setScreen('locker'), 600)
    } else {
      setTimeout(() => setScreen('unregistered'), 400)
    }
  }

  function handleRegister() {
    if (!form.name || !form.studentId) return
    const newUsers = { ...users, [uid]: { ...form } }
    setUsers(newUsers)
    setStatusMessage('Registration Successful')
    setTimeout(() => setScreen('status'), 500)
  }

  function openLocker() {
    const station = arguments.length ? arguments[0] : selectedStation
    if (!station) return
    if (lockerStates[station]) {
      setStatusMessage(`Locker ${station} Already Open`)
    } else {
      setLockerStates((s) => ({ ...s, [station]: true }))
      setStatusMessage(`Locker ${station} Opened`)
    }
    setScreen('status')
  }
  function closeLocker() {
    const station = arguments.length ? arguments[0] : selectedStation
    if (!station) return
    if (!lockerStates[station]) {
      setStatusMessage(`Locker ${station} Already Closed`)
    } else {
      setLockerStates((s) => ({ ...s, [station]: false }))
      setStatusMessage(`Locker ${station} Closed`)
    }
    setScreen('status')
  }

  return (
    <div className="app-root">
      {screen === 'welcome' && (
        <Screen>
          <div className="nfc-spot">
            <div className="nfc-ring">
              <IconNFC />
            </div>  
            <h1 className="title">Tap NFC Card</h1>
            <p className="subtitle">Hold your card near the reader</p>
            <div className="status-row">
              <div className="status-dot good"></div>
              <div className="status-text">Cabinet Ready</div>
            </div>
            <div className="dev-footer">
              <button className="dev-link" onClick={() => simulateTap('DEV-REGISTERED')}>[Dev: Tap Registered]</button>
              <button className="dev-link" onClick={() => simulateTap('DEV-UNREGISTERED')}>[Dev: Tap Unregistered]</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'unregistered' && (
        <Screen>
          <div className="panel">
            <IconNFC className="icon-med" />
            <h2>UID Not Registered</h2>
            <p className="muted">The card UID was not found in the system.</p>
            <div className="muted">UID: {uid}</div>
            <div className="button-row">
              <button className="btn primary" onClick={() => { setForm({ name: '', section: '', studentId: '' }); setScreen('register') }}>Register User</button>
              <button className="btn ghost" onClick={() => { setUid(null); setScreen('welcome') }}>Cancel</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'register' && (
        <Screen>
          <div className="panel form">
            <h2>Register User</h2>
            <p className="muted">UID will be captured when you tapped the card.</p>
            <div className="muted">Captured UID: {uid}</div>
            <label className="field">Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">Student ID
              <input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} />
            </label>
            <label className="field">Section
              <input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
            </label>
            <div className="button-row">
              <button className="btn primary" onClick={handleRegister}>Complete Registration</button>
              <button className="btn ghost" onClick={() => setScreen('welcome')}>Cancel</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'station' && (
        <Screen>
          <div className="panel">
            <h2>Choose Station</h2>
            <div className="muted">User: {users[uid]?.name || 'Unknown'} — {uid}</div>
            <div className="grid">
              <button className="btn large" onClick={() => {
                setSelectedStation(1)
                // if we have a uid and it's registered, go to locker options
                if (uid && users[uid]) {
                  setScreen('locker')
                } else if (uid && !users[uid]) {
                  // uid present but not registered -> go register
                  setScreen('register')
                } else {
                  // no uid -> go to tap flow
                  setScreen('tap')
                }
              }}>Station 1
                <div className="muted" style={{fontSize:12, marginTop:6}}>Status: {lockerStates[1] ? 'Open' : 'Closed'}</div>
              </button>
              <button className="btn large" onClick={() => {
                setSelectedStation(2)
                if (uid && users[uid]) {
                  setScreen('locker')
                } else if (uid && !users[uid]) {
                  setScreen('register')
                } else {
                  setScreen('tap')
                }
              }}>Station 2
                <div className="muted" style={{fontSize:12, marginTop:6}}>Status: {lockerStates[2] ? 'Open' : 'Closed'}</div>
              </button>
            </div>
            <div className="button-row">
              <button className="btn ghost" onClick={() => setScreen('welcome')}>Back</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'tap' && (
        <Screen>
          <div className="nfc-spot">
            <div className="nfc-ring">
              <IconNFC />
            </div>
            <h1 className="title">Tap NFC Card</h1>
            <p className="subtitle">Station {selectedStation} — Hold card near the reader</p>
            <div className="status-row">
              <div className="status-dot good"></div>
              <div className="status-text">Waiting for card</div>
            </div>
            <div className="dev-footer">
              <button className="dev-link" onClick={() => simulateTap('DEV-REGISTERED')}>[Dev: Tap Registered]</button>
              <button className="dev-link" onClick={() => simulateTap('DEV-UNREGISTERED')}>[Dev: Tap Unregistered]</button>
            </div>
            <div className="button-row">
              <button className="btn ghost" onClick={() => { setSelectedStation(null); setScreen('station') }}>Back</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'locker' && (
        <Screen>
          <div className="panel">
            <h2>Locker Options — Station {selectedStation}</h2>
            <div className="button-row">
              <button className="btn primary" onClick={openLocker}>Open Locker</button>
              <button className="btn secondary" onClick={closeLocker}>Close Locker</button>
            </div>
            <div className="button-row">
              <button className="btn ghost" onClick={() => setScreen('station')}>Back</button>
            </div>
          </div>
        </Screen>
      )}

      {screen === 'status' && (
        <Screen>
          <div className="panel status-panel">
            <IconLock open={statusMessage.toLowerCase().includes('open')} />
            <h2>{statusMessage}</h2>
            <div className="button-row">
              <button className="btn primary" onClick={() => setScreen('welcome')}>Done</button>
            </div>
          </div>
        </Screen>
      )}
    </div>
  )
}
