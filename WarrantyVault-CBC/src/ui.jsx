import { formatDate } from './data'

export function Status({ value }) {
  return <span className={`status status-${value.toLowerCase().replaceAll(' ', '-')}`}><i />{value}</span>
}

export function Empty({ title, text, action }) {
  return <div className="empty"><span>◇</span><strong>{title}</strong><p>{text}</p>{action && <button className="outline-button" onClick={action}>Get started</button>}</div>
}

// Circular progress ring. `color` can be any CSS colour or var(--token).
export function Ring({ pct = 0, size = 64, stroke = 6, color = 'currentColor', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{children}</span>
    </div>
  )
}

export function Stat({ label, value, unit, note, tone = 'ok' }) {
  return <article className="stat-card"><span className="stat-label">{label}</span><div className="stat-figure"><strong className="stat-value">{value}</strong>{unit && <span className={`stat-unit tone-${tone}`}>{unit}</span>}</div><span className="stat-note">{note}</span></article>
}

export function ServicePanel({ claims, productFor, onOpen, onHistory, subtitle = 'Appointments on your calendar' }) {
  const scheduled = claims.filter((c) => c.status === 'Scheduled')
  return (
    <section className="panel service-panel">
      <div className="panel-head"><div><h2>Upcoming service</h2><p>{subtitle}</p></div><button className="panel-more" aria-label="More options">···</button></div>
      {scheduled.length ? scheduled.slice(0, 2).map((c) => (
        <div className="service-card" key={c.id}>
          <div className="calendar-date"><strong>{new Date(`${c.slot}T12:00:00`).getDate()}</strong><span>{new Date(`${c.slot}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span></div>
          <div><strong>{productFor(c)?.name}</strong><span>{c.center}</span><span>{formatDate(c.slot)}{c.slotTime ? ` · ${c.slotTime}` : ''}</span></div>
          <button aria-label="View claim" onClick={() => onOpen(c)}>↗</button>
        </div>
      )) : <Empty title="No upcoming appointments" text="Approved repairs will show up here once scheduled." />}
      {onHistory && <button className="outline-button full-button" onClick={onHistory}>View service history <span>→</span></button>}
    </section>
  )
}
