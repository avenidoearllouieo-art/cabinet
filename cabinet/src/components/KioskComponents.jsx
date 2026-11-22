export function KioskIcon({ name, size = 22 }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  const icons = {
    open: <><path d="M4 20V5a2 2 0 0 1 2-2h10v17" /><path d="M16 7h4v13h-4" /><path d="m11 12 4 0m-2-2 2 2-2 2" /></>,
    close: <><path d="M4 20V5a2 2 0 0 1 2-2h14v17H4Z" /><path d="M10 12H6m2-2-2 2 2 2" /></>,
    recovery: <><circle cx="12" cy="15" r="4" /><path d="M12 11V3m-3 3 3-3 3 3" /><path d="M5 19h14" /></>,
    status: <><path d="M4 19V5m0 14h16" /><path d="m7 15 3-4 3 2 5-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="M10.3 3.9 2.4 17.5A1.7 1.7 0 0 0 3.9 20h16.2a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 3h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.9 9a7.5 7.5 0 0 1 12.4-2L20 12M4 17v-5h5" /><path d="M19.1 15a7.5 7.5 0 0 1-12.4 2L4 12" /></>,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} {...common}>
      {icons[name] || icons.status}
    </svg>
  )
}

export function TapTrackHeader({ title, bridgeStatus, bridgeLabel, clock }) {
  return (
    <header className="kiosk-header">
      <a className="kiosk-brand" href="#home" aria-label="TapTrack Cabinet Management" onClick={(event) => event.preventDefault()}>
        <img src="/logo1.png" alt="TapTrack" />
        <span>LAB EQUIPMENT ACCESS</span>
      </a>
      <div className="kiosk-header-title" aria-live="polite">{title}</div>
      <div className="kiosk-header-meta">
        <StatusBadge state={bridgeStatus}>
          <span className="status-indicator" />
          NFC {bridgeLabel}
        </StatusBadge>
        <span className="kiosk-header-clock"><KioskIcon name="clock" size={17} />{clock}</span>
      </div>
    </header>
  )
}

export function StatusBadge({ state = 'neutral', children }) {
  return <span className={`status-badge is-${state}`}>{children}</span>
}

export function StationCard({ label, state = 'available', detail, onClick, disabled = false, children }) {
  const Element = onClick ? 'button' : 'article'
  const stateLabel = state === 'occupied' ? 'Occupied' : state === 'busy' ? 'In progress' : 'Available'
  return (
    <Element
      type={onClick ? 'button' : undefined}
      className={`station-card is-${state}`}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-pressed={onClick ? state === 'selected' : undefined}
    >
      <div className="station-card-head">
        <span className="station-glyph"><KioskIcon name={state === 'occupied' ? 'close' : 'open'} size={24} /></span>
        <StatusBadge state={state === 'occupied' ? 'warning' : state === 'busy' ? 'info' : 'success'}>
          <span className="status-indicator" />{state === 'selected' ? 'Selected' : stateLabel}
        </StatusBadge>
      </div>
      <strong className="station-card-title">{String(label).toUpperCase()}</strong>
      {detail && <span className="station-card-detail">{detail}</span>}
      {children}
    </Element>
  )
}

export function ParticipantCard({ participant, index, state = 'success' }) {
  return (
    <article className={`participant-card is-${state}`}>
      <span className="participant-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="participant-avatar" aria-hidden="true">
        {String(participant.fullName || '?').trim().charAt(0).toUpperCase()}
      </span>
      <span className="participant-copy">
        <strong>{participant.fullName || 'Student'}</strong>
        <small>{participant.studentId || 'Student ID unavailable'}</small>
      </span>
      <span className="participant-check" aria-label={state === 'success' ? 'Recorded' : undefined}>
        <KioskIcon name={state === 'success' ? 'check' : 'warning'} size={18} />
      </span>
    </article>
  )
}

export function NFCScanIndicator({ title = 'Ready to scan', description, compact = false, state = 'waiting' }) {
  return (
    <div className={`nfc-scan-indicator ${compact ? 'is-compact' : ''} is-${state}`} role="status" aria-live="polite">
      <span className="nfc-scan-art" aria-hidden="true">
        <svg viewBox="0 0 72 72">
          <circle className="nfc-wave nfc-wave-one" cx="36" cy="36" r="30" />
          <circle className="nfc-wave nfc-wave-two" cx="36" cy="36" r="23" />
          <path d="M33 25c7 0 12 5 12 11s-5 11-12 11M29 30c4 0 7 3 7 6s-3 6-7 6M24 24v24" />
        </svg>
      </span>
      <span className="nfc-scan-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </div>
  )
}

export function WorkflowProgress({ steps, activeIndex }) {
  return (
    <ol className="workflow-progress" aria-label="Workflow progress">
      {steps.map((step, index) => (
        <li className={index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : ''} key={step}>
          <span className="workflow-step-mark">{index < activeIndex ? <KioskIcon name="check" size={14} /> : index + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  )
}

export function CabinetAnimation({ direction = 'opening', active = false }) {
  return (
    <div className={`cabinet-illustration ${active ? `is-animating is-${direction}` : ''}`} role="img" aria-label={`Illustration of the cabinet ${direction}; this animation does not confirm physical movement`}>
      <svg viewBox="0 0 260 172" preserveAspectRatio="xMidYMid meet">
        <rect className="cabinet-frame" x="38" y="8" width="184" height="156" rx="8" />
        <rect className="cabinet-inner" x="53" y="23" width="154" height="126" rx="3" />
        <path className="cabinet-rail" d="M53 39h154M53 50h154M53 61h154M53 72h154M53 83h154M53 94h154M53 105h154M53 116h154M53 127h154M53 138h154" />
        <g className="cabinet-shutter">
          <rect x="55" y="25" width="150" height="120" rx="2" />
          <path d="M55 38h150M55 51h150M55 64h150M55 77h150M55 90h150M55 103h150M55 116h150M55 129h150" />
          <rect className="cabinet-handle" x="115" y="134" width="30" height="5" rx="2.5" />
        </g>
        <path className="cabinet-base" d="M27 164h206" />
        <circle className="cabinet-status-light" cx="193" cy="16" r="3" />
      </svg>
    </div>
  )
}

export function SessionSummary({ rows }) {
  return (
    <dl className="session-summary">
      {rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== '').map((row) => (
        <div className="session-summary-item" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function EmptyState({ title, description, icon = 'status' }) {
  return (
    <div className="kiosk-empty-state" role="status">
      <span className="kiosk-empty-icon"><KioskIcon name={icon} size={24} /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  )
}

export function ErrorMessage({ children }) {
  if (!children) return null
  return (
    <div className="kiosk-error" role="alert">
      <KioskIcon name="warning" size={22} />
      <span>{children}</span>
    </div>
  )
}

export function LoadingIndicator({ label = 'Loading' }) {
  return <span className="kiosk-loading" role="status"><span className="kiosk-spinner" />{label}</span>
}