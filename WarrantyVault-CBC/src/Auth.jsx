import { useRef, useState } from 'react'
import Icon, { categoryIcon } from './icons'
import { Ring } from './ui'
import { expiry } from './data'
import { daysUntil, relativeDay } from './dates'

// Demo-only gate in the browser, not real authentication. The customer email is the backend's seeded demo customer
// (the server identifies customers by email). The service team's "password" is the server's staff key, checked by
// the server at sign-in, so it is deliberately not stored here.
export const DEMO = {
  customer: { email: 'demo@warrantyvault.dev', password: 'Demo@123', name: 'Demo Customer' },
  admin: { email: 'adjuster@warrantyvault.internal', code: '123456' },
}

function Brand({ chip, tagline, tone }) {
  return (
    <div className={`auth-brand ${tone}`}>
      <span className="auth-brand-mark"><Icon name="shield-check" size={22} /></span>
      <span className="auth-brand-text">
        <span><b>WarrantyVault</b>{chip && <em>{chip}</em>}</span>
        <small>{tagline}</small>
      </span>
    </div>
  )
}

export function CustomerLogin({ products, onSignIn, onSwitch, notify }) {
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const showcase = products
    .map((p) => ({ p, left: expiry(p) ? daysUntil(expiry(p)) : null }))
    .filter((x) => x.left !== null && x.left >= 0)
    .sort((a, b) => a.left - b.left)
    .slice(0, 3)

  const submit = async (event) => {
    event.preventDefault()
    if (email.trim().toLowerCase() !== DEMO.customer.email || password !== DEMO.customer.password) return setError('Those details don’t match the demo account. Use Auto-fill to try it.')
    setBusy(true); setError('')
    try { await onSignIn(remember, DEMO.customer.email, DEMO.customer.name) } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="auth auth-customer theme-customer">
      <section className="auth-hero">
        <Brand chip="Customer Vault" tagline="CARE, MADE SIMPLE" tone="light" />
        <div className="auth-hero-copy">
          <h1>Never lose a warranty again.</h1>
          <p>Your digital vault for every device, receipt, and repair claim.</p>
        </div>
        <div className="auth-stack" aria-hidden="true">
          {showcase.map(({ p, left }, i) => (
            <div className="auth-stack-card" key={p.id} style={{ marginLeft: i === 1 ? 18 : 0 }}>
              <span className="auth-stack-icon"><Icon name={categoryIcon(p.category)} /></span>
              <span className="auth-stack-copy">
                <strong>{p.brand} {p.name}</strong>
                <small>{p.category || 'Product'} · {p.serial}</small>
              </span>
              {left !== null && <Ring pct={Math.max(0, left) / (p.duration * 30.4)} size={44} stroke={4} color={left <= 30 ? 'var(--danger)' : left <= 120 ? 'var(--warn)' : 'var(--ok)'}>{Math.max(0, left)}d</Ring>}
            </div>
          ))}
        </div>
        <ul className="auth-trust">
          <li><Icon name="lock" size={14} /> Stored in your WarrantyVault account</li>
          <li><Icon name="shield" size={14} /> Not verified with manufacturers</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>Welcome back</h2>
          <p className="auth-sub">Access your protected products and active claims</p>
          <div className="demo-access">
            <Icon name="key" size={16} />
            <span><small>DEMO ACCESS</small><b>{DEMO.customer.email} / {DEMO.customer.password}</b></span>
            <button type="button" onClick={() => { setEmail(DEMO.customer.email); setPassword(DEMO.customer.password); setError('') }}>Auto-fill</button>
          </div>
          <form onSubmit={submit} noValidate>
            <label className="auth-field">Email address
              <span className="auth-input"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="you@example.com" /><Icon name="mail" size={16} /></span>
            </label>
            <label className="auth-field">Password
              <span className="auth-input"><input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Your password" /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name={show ? 'eye-off' : 'eye'} size={16} /></button></span>
            </label>
            <div className="auth-row">
              <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
              <button type="button" className="link-button" onClick={() => notify('Password reset isn’t available in this demo')}>Forgot password?</button>
            </div>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to Vault'} <Icon name="arrow-right" size={16} /></button>
          </form>
          <div className="auth-divider"><span>OR CONTINUE WITH</span></div>
          <button type="button" className="auth-google" onClick={() => notify('Google sign-in isn’t connected in this demo')}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
            Continue with Google
          </button>
          <p className="auth-foot">Don’t have a vault yet? <button type="button" className="link-button strong" onClick={() => notify('Account creation isn’t available in this demo')}>Create account</button></p>
        </div>
        <button type="button" className="auth-switch" onClick={onSwitch}><Icon name="wrench" size={14} /> Service team? Admin login →</button>
      </section>
    </div>
  )
}

function CodeBoxes({ digits, setDigits }) {
  const refs = useRef([])
  const put = (i, value) => { const next = [...digits]; next[i] = value; setDigits(next) }
  return (
    <div className="code-row">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={d}
          aria-label={`Verification digit ${i + 1}`}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(-1); put(i, v); if (v && i < 5) refs.current[i + 1]?.focus() }}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus() }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!text) return
            e.preventDefault()
            setDigits(Array.from({ length: 6 }, (_, k) => text[k] || ''))
            refs.current[Math.min(text.length, 5)]?.focus()
          }}
        />
      ))}
    </div>
  )
}

export function AdminLogin({ centers, claims, products, onSignIn, onSwitch, serverError }) {
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [centerId, setCenterId] = useState(centers[0]?.id || '')
  const [digits, setDigits] = useState(Array(6).fill(''))
  const [error, setError] = useState('')
  const feed = claims
    .flatMap((c) => c.history.map((h, i) => ({ c, h, i })))
    .sort((a, b) => (a.h.date < b.h.date ? 1 : a.h.date > b.h.date ? -1 : b.i - a.i))
    .slice(0, 4)
  const productName = (c) => products.find((p) => p.id === c.productId)?.name || 'Product'

  const submit = async (event) => {
    event.preventDefault()
    const center = centers.find((c) => c.id === (centerId || centers[0]?.id))
    if (email.trim().toLowerCase() !== DEMO.admin.email || digits.join('') !== DEMO.admin.code) return setError('Check your email and 6-digit code. Auto-fill fills in the demo values.')
    if (!center) return setError(serverError || 'Service centres haven’t loaded yet. Try again in a moment.')
    if (!password) return setError('Enter the staff key as your password.')
    setBusy(true); setError('')
    try { await onSignIn(center.name, password) } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="auth auth-admin theme-admin">
      <div className="auth-shell">
        <section className="auth-hero">
          <Brand chip="Service console" tagline="" tone="dark" />
          <div className="auth-hero-copy">
            <h1>Validate. Schedule. Resolve.</h1>
            <p>The service-team workspace for reviewing warranty claims, scheduling repairs and keeping the queue moving.</p>
          </div>
          <div className="feed-label"><span><i /> RECENT CLAIM ACTIVITY</span><span>LIVE DATA</span></div>
          <ul className="auth-feed">
            {!feed.length && <li><i /><span>Sign in to see live claim activity.</span></li>}
            {feed.map(({ c, h }, idx) => (
              <li key={`${c.id}-${idx}`}><i /><span>{productName(c)} · <b>{h.status}</b> <code>#{c.id}</code></span><time>{relativeDay(h.date)}</time></li>
            ))}
          </ul>
          <div className="auth-meta"><span><Icon name="lock" size={13} /> Demo email and code · staff key checked by the server</span><span>Ops-Core demo</span></div>
        </section>

        <section className="auth-panel">
          <div className="auth-title-row"><h2>Service sign in</h2><button type="button" className="mono-link" onClick={() => { setEmail(DEMO.admin.email); setDigits(DEMO.admin.code.split('')); setError('') }}>Auto-fill demo</button></div>
          <span className="restricted"><Icon name="lock" size={12} /> Service team access</span>
          <form onSubmit={submit} noValidate>
            <label className="auth-field">WORK EMAIL
              <span className="auth-input"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="adjuster@warrantyvault.internal" autoComplete="username" /></span>
            </label>
            <label className="auth-field"><span className="field-top">PASSWORD<button type="button" className="mono-link" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></span>
              <span className="auth-input"><input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" /></span>
            </label>
            <label className="auth-field">SERVICE CENTRE
              <span className="auth-input select"><select value={centerId || centers[0]?.id || ''} onChange={(e) => setCenterId(e.target.value)}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.city}</option>)}</select><Icon name="chevron-down" size={16} /></span>
            </label>
            <div className="auth-field"><span className="field-top">6-DIGIT VERIFICATION CODE<small>Demo code {DEMO.admin.code}</small></span><CodeBoxes digits={digits} setDigits={setDigits} /></div>
            {(error || serverError) && <div className="auth-error" role="alert">{error || serverError}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Enter console'} <Icon name="arrow-right" size={16} /></button>
          </form>
          <p className="auth-foot">Customer? <button type="button" className="link-button strong" onClick={onSwitch}>Customer login →</button></p>
        </section>
      </div>
    </div>
  )
}
