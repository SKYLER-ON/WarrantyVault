import { useState } from 'react'
import Icon, { categoryIcon } from './icons'
import { Empty, Ring, Stat, ServicePanel, Status } from './ui'
import { expiry, formatDate } from './data'
import { daysBetween, daysUntil, relativeDay } from './dates'
import { CLOSED } from './adapters'

const STEPS = ['Submitted', 'Approved', 'Scheduled', 'In Repair', 'Ready']
const STEP_INDEX = { Submitted: 0, 'Under Review': 0, Approved: 1, Scheduled: 2, 'In Repair': 3, Completed: 4 }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const ringColor = (left) => (left <= 30 ? 'var(--danger)' : left <= 120 ? 'var(--warn)' : 'var(--ok)')

function coverage(product) {
  const end = expiry(product)
  const left = end ? daysUntil(end) : null
  const total = end && product.purchaseDate ? Math.max(1, daysBetween(product.purchaseDate, end)) : null
  return { product, end, left, pct: left !== null && total ? left / total : 0 }
}

/* ───────────────────────── Customer home ───────────────────────── */

export function CustomerHome({ products, claims, counts, productFor, openModal, beginClaim, openDetails }) {
  const [radar, setRadar] = useState('All')
  const rows = products.map(coverage)
  const active = rows.filter((r) => r.left !== null && r.left >= 0).sort((a, b) => a.left - b.left)
  const focus = active[0]
  const open = claims.filter((c) => !CLOSED.includes(c.status))
  const tracked = [...open].sort((a, b) => STEP_INDEX[b.status] - STEP_INDEX[a.status] || (a.updated < b.updated ? 1 : -1))[0]
  const step = tracked ? STEP_INDEX[tracked.status] : 0
  const heroTone = !focus ? 'ok' : focus.left <= 30 ? 'danger' : focus.left <= 90 ? 'warn' : 'ok'
  const heroBadge = { danger: 'NEEDS ATTENTION', warn: 'EXPIRING SOON', ok: 'NEXT TO EXPIRE' }[heroTone]

  const groups = {
    All: rows,
    Active: rows.filter((r) => r.left !== null && r.left >= 0),
    Expiring: rows.filter((r) => r.left !== null && r.left >= 0 && r.left <= 90),
    Expired: rows.filter((r) => r.left !== null && r.left < 0),
  }
  const radarRows = [...groups[radar]].sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9))

  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-top"><span className={`hero-badge ${heroTone}`}><i /> {focus ? heroBadge : 'ALL CLEAR'}</span>{focus && <code>{focus.product.serial}</code>}</div>
          {focus ? (
            <>
              <div className="hero-body">
                <Ring pct={focus.pct} size={104} stroke={9} color={ringColor(focus.left)}><b>{focus.left}d</b><small>LEFT</small></Ring>
                <div>
                  <h2>{focus.product.brand} {focus.product.name} {focus.left === 0 ? 'expires today' : `expires on ${formatDate(focus.end)}`}</h2>
                  <p>{focus.left === 0 ? 'Coverage ends today.' : `Coverage ends in ${plural(focus.left, 'day')}.`} If something isn’t right, start a claim before it lapses.</p>
                </div>
              </div>
              <div className="hero-actions">
                <button className="btn-coral" onClick={() => beginClaim(focus.product)}><Icon name="shield-check" size={16} /> Start a claim</button>
                <button className="btn-text-light" onClick={() => openModal('product', focus.product)}><Icon name="refresh" size={16} /> Edit coverage</button>
              </div>
            </>
          ) : (
            <>
              <div className="hero-body"><div><h2>No active warranties</h2><p>Register a product to start tracking its coverage and expiry date.</p></div></div>
              <div className="hero-actions"><button className="btn-coral" onClick={() => openModal('product')}><Icon name="plus" size={16} /> Add a product</button></div>
            </>
          )}
        </article>

        <article className="repair-card">
          <div className="repair-top"><span className="chip-soft"><Icon name="wrench" size={13} /> {tracked ? 'CLAIM IN PROGRESS' : 'NO OPEN CLAIMS'}</span>{tracked && <code>#{tracked.id}</code>}</div>
          {tracked ? (
            <>
              <h3>{productFor(tracked)?.name || 'Product'}</h3>
              <p className="repair-sub">{tracked.center || 'Awaiting a service center'} · {tracked.type}</p>
              <ol className="stepper" aria-label="Claim progress">
                {STEPS.map((label, i) => (
                  <li key={label} className={i < step ? 'done' : i === step ? 'current' : ''}>
                    <span className="step-dot">{i < step && <Icon name="check" size={11} strokeWidth={3} />}</span>
                    <span className="step-label">{label}</span>
                  </li>
                ))}
              </ol>
              <dl className="repair-info">
                <div><dt><Icon name="clipboard" size={14} /> Issue</dt><dd>{tracked.issue}</dd></div>
                <div><dt><Icon name="clock" size={14} /> {tracked.slot ? 'Appointment' : 'Status'}</dt><dd>{tracked.slot ? formatDate(tracked.slot) : tracked.status}</dd></div>
              </dl>
              <button className="btn-dark" onClick={() => openDetails(tracked)}><Icon name="activity" size={16} /> Open tracker</button>
            </>
          ) : (
            <>
              <h3>Nothing in the workshop</h3>
              <p className="repair-sub">Need something looked at? Start a claim and track it here.</p>
              <button className="btn-dark" onClick={() => beginClaim()}><Icon name="plus" size={16} /> Get service</button>
            </>
          )}
        </article>
      </section>

      <section className="stat-grid">
        <Stat label="REGISTERED PRODUCTS" value={products.length} unit="Units" note="Serial numbers on record" tone="ink" />
        <Stat label="ACTIVE WARRANTIES" value={counts.active} unit="Active" note="Currently in coverage" tone="ok" />
        <Stat label="EXPIRING SOON" value={counts.expiring} unit="Within 90 days" note="Worth a look before they lapse" tone={counts.expiring ? 'danger' : 'ink'} />
        <Stat label="OPEN SERVICE CLAIMS" value={counts.open} unit="Tracking" note="Claims currently in progress" tone="warn" />
      </section>

      <section className="radar">
        <div className="section-head">
          <div><h2>Warranty radar</h2><p>Coverage timeline for every product you’ve registered</p></div>
          <div className="chip-group" role="tablist" aria-label="Filter warranty radar">
            {Object.keys(groups).map((name) => <button key={name} role="tab" aria-selected={radar === name} className={radar === name ? 'on' : ''} onClick={() => setRadar(name)}>{name} ({groups[name].length})</button>)}
          </div>
        </div>
        {radarRows.length ? (
          <div className="radar-grid">
            {radarRows.map(({ product: p, end, left, pct }) => (
              <button className="radar-card" key={p.id} onClick={() => openModal('product', p)} aria-label={`Edit ${p.brand} ${p.name}`}>
                <span className="radar-copy"><small>{p.brand.toUpperCase()}</small><strong>{p.name}</strong><em><Icon name={categoryIcon(p.category)} size={13} /> {end ? `Ends ${formatDate(end)}` : 'No expiry on file'}</em></span>
                {left !== null ? <Ring pct={pct} size={58} stroke={5} color={ringColor(left)}>{left < 0 ? '—' : `${left}d`}<small>{left < 0 ? 'ENDED' : 'LEFT'}</small></Ring> : <Ring size={58} stroke={5}>—</Ring>}
              </button>
            ))}
          </div>
        ) : <div className="panel"><Empty title="Nothing in this view" text="Try another filter above." /></div>}
      </section>
    </>
  )
}

/* ───────────────────────── Admin / control room ───────────────────────── */

// Colours follow the status chips: amber/orange = awaiting decision, blue = approved/scheduled, violet = in repair.
const PIPELINE = [
  ['Submitted', '#f2c46b'], ['Under Review', '#f2a36b'], ['Approved', '#7fb2ea'], ['Scheduled', '#a9d3f7'],
  ['In Repair', '#b9a7f0'], ['Completed', '#a9dfb8'], ['Rejected', '#ef6b6b'], ['Cancelled', '#c4c4cc'],
]
const URGENCY = ['Submitted', 'Under Review', 'Approved', 'Scheduled', 'In Repair']
const eventIcon = { Submitted: 'plus', 'Under Review': 'search', Approved: 'check', Scheduled: 'clock', 'In Repair': 'wrench', Completed: 'shield-check', Rejected: 'x', Cancelled: 'x' }

function Donut({ segments, total }) {
  const r = 52, c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Claims by status">
        <circle cx="70" cy="70" r={r} fill="none" strokeWidth="16" className="ring-track" />
        {total > 0 && segments.filter((s) => s.count).map((s) => {
          const len = (s.count / total) * c
          const el = <circle key={s.name} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
          acc += len
          return el
        })}
      </svg>
      <div className="donut-center"><b>{total}</b><small>TOTAL CLAIMS</small></div>
    </div>
  )
}

function FlowChart({ claims }) {
  const WEEKS = 6
  const intake = Array(WEEKS).fill(0), resolved = Array(WEEKS).fill(0)
  const bucket = (date) => { const ago = Math.floor(-daysUntil(date) / 7); return ago >= 0 && ago < WEEKS ? WEEKS - 1 - ago : -1 }
  claims.forEach((c) => {
    const i = bucket(c.submitted); if (i >= 0) intake[i]++
    c.history.filter((h) => CLOSED.includes(h.status)).forEach((h) => { const j = bucket(h.date); if (j >= 0) resolved[j]++ })
  })
  const max = Math.max(3, ...intake, ...resolved)
  const W = 600, H = 190, padX = 24, padTop = 16, padBottom = 28
  const x = (i) => padX + (i * (W - padX * 2)) / (WEEKS - 1)
  const y = (v) => padTop + (1 - v / max) * (H - padTop - padBottom)
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const labels = ['5w ago', '4w', '3w', '2w', 'Last wk', 'This wk']
  return (
    <svg className="flow-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Claims submitted and resolved per week">
      {[0, 0.5, 1].map((t) => <line key={t} x1={padX} x2={W - padX} y1={y(max * t)} y2={y(max * t)} className="grid-line" />)}
      <path d={`${line(intake)} L${x(WEEKS - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="flow-area" />
      <path d={line(intake)} className="flow-line intake" />
      <path d={line(resolved)} className="flow-line resolved" />
      {intake.map((v, i) => <circle key={`i${i}`} cx={x(i)} cy={y(v)} r="3.5" className="dot intake" />)}
      {resolved.map((v, i) => <circle key={`r${i}`} cx={x(i)} cy={y(v)} r="3.5" className="dot resolved" />)}
      {labels.map((l, i) => <text key={l} x={x(i)} y={H - 8} textAnchor="middle" className="axis-label">{l}</text>)}
    </svg>
  )
}

export function AdminHome({ role, claims, productFor, nextStatus, updateClaim, openDetails, openSchedule, setPage }) {
  const pending = claims.filter((c) => ['Submitted', 'Under Review'].includes(c.status))
  const approved = claims.filter((c) => c.status === 'Approved')
  const completed = claims.filter((c) => c.status === 'Completed')
  const decided = claims.filter((c) => !['Submitted', 'Under Review'].includes(c.status))
  const accepted = decided.filter((c) => c.status !== 'Rejected')
  const approvalRate = decided.length ? Math.round((accepted.length / decided.length) * 100) : null
  const resolveDays = completed.map((c) => { const end = [...c.history].reverse().find((h) => h.status === 'Completed')?.date || c.updated; return daysBetween(c.submitted, end) })
  const avgResolve = resolveDays.length ? Math.round((resolveDays.reduce((a, b) => a + b, 0) / resolveDays.length) * 10) / 10 : null

  // Every open claim needs the team to move it forward; decisions first, then oldest-waiting first.
  const needs = claims.filter((c) => URGENCY.includes(c.status)).sort((a, b) => URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status) || (a.updated > b.updated ? 1 : -1))
  const segments = PIPELINE.map(([name, color]) => ({ name, color, count: claims.filter((c) => c.status === name).length }))
  const feed = claims
    .flatMap((c) => c.history.map((h, i) => ({ c, h, i })))
    .sort((a, b) => (a.h.date < b.h.date ? 1 : a.h.date > b.h.date ? -1 : b.i - a.i))
    .slice(0, 5)

  return (
    <>
      <section className="kpi-grid">
        <article className="kpi"><span className="kpi-label">CLAIMS IN SYSTEM</span><strong>{claims.length}</strong><small>{claims.filter((c) => !CLOSED.includes(c.status)).length} still open</small></article>
        <article className="kpi"><span className="kpi-label">PENDING REVIEW {pending.length > 0 && <em>Action req</em>}</span><strong>{pending.length}</strong><small>Submitted or under review</small></article>
        <article className="kpi"><span className="kpi-label">AVG RESOLUTION</span><strong>{avgResolve === null ? '—' : <>{avgResolve}<u>d</u></>}</strong><small>{completed.length ? `Across ${plural(completed.length, 'completed claim')}` : 'No completed claims yet'}</small></article>
        <article className="kpi"><span className="kpi-label">AWAITING SCHEDULING</span><strong>{approved.length}</strong><small>Approved, no appointment yet</small></article>
        <article className="kpi"><span className="kpi-label">APPROVAL RATE</span><strong className="mint">{approvalRate === null ? '—' : <>{approvalRate}<u>%</u></>}</strong><small>{decided.length ? `${accepted.length} of ${decided.length} decided` : 'No decisions yet'}</small></article>
      </section>

      {role === 'Team Leader' && (
        <section className="leader-strip">
          <div><div className="eyebrow">TEAM PULSE</div><h2>Service operations</h2></div>
          <div className="pulse-stat"><strong>{claims.filter((c) => c.status === 'Under Review').length}</strong><span>Awaiting review</span></div>
          <div className="pulse-stat"><strong>{claims.filter((c) => c.status === 'In Repair').length}</strong><span>In repair</span></div>
          <div className="pulse-stat"><strong>{completed.length}</strong><span>Completed this cycle</span></div>
          <button className="text-button" onClick={() => setPage('Team members')}>View team →</button>
        </section>
      )}

      <div className="control-grid">
        <div className="control-col">
          <section className="panel triage-panel">
            <div className="panel-head"><div><h2><Icon name="alert" size={16} /> Needs you now</h2><p>Open claims, most urgent first</p></div><span className="count-tag">{needs.length} open</span></div>
            {needs.length ? needs.slice(0, 4).map((c) => {
              const wait = Math.max(0, -daysUntil(c.updated))
              return (
                <article className={`triage tri-${c.status.toLowerCase().replaceAll(' ', '-')}`} key={c.id}>
                  <div className="triage-top"><span><code>#{c.id}</code> · <strong>{productFor(c)?.name || 'Unknown product'}</strong></span><span className="wait-tag">{wait === 0 ? 'Updated today' : `Waiting ${wait}d`}</span></div>
                  <p>{c.issue}</p>
                  <div className="triage-meta"><Status value={c.status} /><span>{productFor(c)?.brand} · {c.type}</span></div>
                  <div className="triage-actions">
                    {c.status === 'Approved'
                      ? <button className="btn-mint" onClick={() => openSchedule(c)}>Schedule →</button>
                      : <button className="btn-mint" onClick={() => updateClaim(c, nextStatus[c.status])}>{nextStatus[c.status]} →</button>}
                    {['Submitted', 'Under Review'].includes(c.status) && <button className="btn-reject" onClick={() => updateClaim(c, 'Rejected', 'Rejected after team review.')}>Reject</button>}
                    <button className="btn-outline" onClick={() => openDetails(c)}>Open dossier →</button>
                  </div>
                </article>
              )
            }) : <Empty title="The queue is clear" text="No open claims need the team right now." />}
            {needs.length > 4 && <button className="panel-link" onClick={() => setPage('Claims queue')}>View all {needs.length} open claims →</button>}
          </section>

          <section className="panel flow-panel">
            <div className="panel-head"><div><h2>Claim flow · last 6 weeks</h2><p>Submitted vs. resolved (completed or rejected) per week</p></div>
              <div className="legend"><span><i className="intake" /> Submitted</span><span><i className="resolved" /> Resolved</span></div></div>
            <FlowChart claims={claims} />
          </section>
        </div>

        <div className="control-col">
          <section className="panel pipeline-panel">
            <div className="panel-head"><div><h2>Pipeline distribution</h2><p>Breakdown across all claims</p></div></div>
            <Donut segments={segments} total={claims.length} />
            <ul className="pipeline-legend">
              {segments.map((s) => <li key={s.name}><i style={{ background: s.color }} /><span>{s.name}</span><b>{s.count}</b><em>{claims.length ? Math.round((s.count / claims.length) * 100) : 0}%</em></li>)}
            </ul>
          </section>

          <section className="panel feed-panel">
            <div className="panel-head"><div><h2>Activity feed</h2><p>Latest status changes</p></div><span className="stream-tag"><i /> LIVE</span></div>
            {feed.length ? feed.map(({ c, h }, idx) => (
              <button className="feed-row" key={`${c.id}-${idx}`} onClick={() => openDetails(c)}>
                <span className="feed-icon"><Icon name={eventIcon[h.status] || 'activity'} size={15} /></span>
                <span className="feed-copy"><strong>{productFor(c)?.name || 'Product'} <code>#{c.id}</code></strong><small>{h.note}</small></span>
                <span className="feed-side"><Status value={h.status} /><time>{relativeDay(h.date)}</time></span>
              </button>
            )) : <Empty title="No activity yet" text="Status changes will appear here." />}
            <button className="panel-link" onClick={() => setPage('Claims queue')}>View claims queue →</button>
          </section>

          <ServicePanel claims={claims} productFor={productFor} onOpen={openDetails} subtitle="Confirmed appointments" />
        </div>
      </div>
    </>
  )
}
