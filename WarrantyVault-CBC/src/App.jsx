import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { expiry, formatDate, team } from './data'
import { IN_90_DAYS, TODAY } from './dates'
import { ApiError, api, hasStaffKey, setStaffKey } from './api'
import { CLOSED, categoryKey, statusKey, toCenter, toClaim, toProduct, toSlotOption } from './adapters'
import Icon from './icons'
import { AdminLogin, CustomerLogin } from './Auth'
import { AdminHome, CustomerHome } from './Dashboards'
import { Empty, ServicePanel, Status } from './ui'
import './App.css'

const nav = { Customer: [['Overview','⌂'],['My products','▣'],['Claims','◇'],['Service history','↻']], 'Team Admin': [['Overview','⌂'],['Claims queue','◇'],['Service centers','⌖']], 'Team Leader': [['Overview','⌂'],['Claims queue','◇'],['Service centers','⌖'],['Team members','♙']] }
const nextStatus = { Submitted: 'Under Review', 'Under Review': 'Approved', Approved: 'Scheduled', Scheduled: 'In Repair', 'In Repair': 'Completed' }
const customerLabels = { Overview: 'Home', 'My products': 'Products', Claims: 'Claims', 'Service history': 'Service history' }
const adminIcons = { Overview: 'grid', 'Claims queue': 'clipboard', 'Service centers': 'pin', 'Team members': 'users' }
const adminGroups = [['CORE OPS', ['Overview', 'Claims queue']], ['DISPATCH & SCHEDULING', ['Service centers']], ['TEAM', ['Team members']]]
const staffPeople = { 'Team Admin': ['JM', 'Jamie Moore'], 'Team Leader': ['MC', 'Maya Chen'] }
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?'
const STAFF_STATUS_KEYS = ['approved', 'rejected', 'in_repair', 'completed']
const SLOT_DAYS = 7
const dayStr = (offset) => { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Open appointment slots for one center over the next few days (from GET /service-centers/:id/slots).
async function loadOpenSlots(center, days = SLOT_DAYS) {
  const results = await Promise.all(Array.from({ length: days }, (_, i) => api.centerSlots(center.id, dayStr(i))))
  return results.flatMap((r) => r.slots.filter((x) => x.available).map((x) => toSlotOption(center.name, x)))
}

// Demo sign-in state. "Remember me" keeps it in localStorage; otherwise it lasts for the browser session.
const SESSION_KEY = 'warrantyvault-session'
function readSession() {
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const saved = JSON.parse(window[store].getItem(SESSION_KEY))
      if (saved?.type === 'customer' && saved.customerId) return saved
      if (saved?.type === 'admin' && hasStaffKey()) return saved // the staff key only lives for the browser session
    } catch { /* storage unavailable */ }
  }
  return null
}
function writeSession(value, remember) {
  for (const store of ['localStorage', 'sessionStorage']) { try { window[store].removeItem(SESSION_KEY) } catch { /* ignore */ } }
  if (!value) return
  try { window[remember ? 'localStorage' : 'sessionStorage'].setItem(SESSION_KEY, JSON.stringify(value)) } catch { /* ignore */ }
}

function App() {
  const [data, setData] = useState({ products: [], claims: [], centers: [], team })
  const [meta, setMeta] = useState({ serviceTypes: [] })
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [slotState, setSlotState] = useState({ centerId: '', loading: false, options: [], error: '' })
  const formRef = useRef(null)
  const loadSeq = useRef(0)
  const [role, setRole] = useState(() => (readSession()?.type === 'admin' ? 'Team Admin' : 'Customer'))
  const [page, setPage] = useState('Overview')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [modal, setModal] = useState('')
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState('')
  const [toastKind, setToastKind] = useState('ok')
  const [error, setError] = useState('')
  const [form, setForm] = useState({})
  const [session, setSession] = useState(readSession)
  const [authView, setAuthView] = useState(() => readSession()?.type || 'customer')
  const [adminSearch, setAdminSearch] = useState('')
  const notify = (msg, kind = 'ok') => { setToastKind(kind); setToast(msg); setTimeout(() => setToast(''), kind === 'error' ? 5200 : 2800) }
  const products = data.products
  const claims = data.claims
  // Staff have no product list endpoint, so a claim carries the product summary the API embeds.
  const currentProduct = (claim) => products.find((item) => item.id === claim.productId) ?? claim.product

  // Loads everything the signed-in person can see. `quiet` refreshes in place after a change.
  const load = useCallback(async (sess, quiet = false) => {
    const seq = ++loadSeq.current
    try {
      const metaRaw = await api.meta()
      const labels = Object.fromEntries(metaRaw.service_types.map((t) => [t.value, t.label]))
      const centersRaw = await api.listCenters()
      let productsRaw = [], claimsRaw = []
      if (sess?.type === 'customer') [productsRaw, claimsRaw] = await Promise.all([api.listProducts(sess.customerId), api.listClaims({ customerId: sess.customerId })])
      else if (sess?.type === 'admin') claimsRaw = await api.listClaims()
      // The list endpoint has no timelines, so each claim is fetched in full (capped to the 100 newest).
      const full = await Promise.all(claimsRaw.slice(0, 100).map((c) => api.getClaim(c.id)))
      if (seq !== loadSeq.current) return
      const claimsNext = full.map((c) => toClaim(c, labels, { hideRisk: sess?.type !== 'admin' }))
      const productsNext = sess?.type === 'customer' ? productsRaw.map(toProduct) : [...new Map(claimsNext.filter((c) => c.product).map((c) => [c.product.id, c.product])).values()]
      setMeta({ serviceTypes: metaRaw.service_types })
      setData((prev) => ({ ...prev, products: productsNext, claims: claimsNext, centers: centersRaw.map((c) => toCenter(c, labels)) }))
      setPhase('ready'); setLoadError('')
    } catch (e) {
      if (seq !== loadSeq.current) return
      if (quiet) notify(`Couldn’t refresh: ${e.message}`, 'error')
      else { setLoadError(e.message); setPhase('error') }
    }
  }, [])
  const counts = useMemo(() => {
    const expiries = products.map((p) => expiry(p))
    const today = TODAY
    return { active: expiries.filter((e) => e && e >= today).length, expiring: expiries.filter((e) => e && e >= today && e <= IN_90_DAYS).length, open: claims.filter((c) => !CLOSED.includes(c.status)).length }
  }, [products, claims])
  const openModal = (name, value = {}) => { setError(''); setForm(value); setSelected(null); setModal(name) }
  const beginClaim = (product) => openModal('claim', { productId: product?.id || '', type: '', issue: '' })
  // Registering is the only product write the backend offers (there is no product edit endpoint).
  const saveProduct = async (event) => {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget))
    if (form.id) return setError('Editing a registered product isn’t supported by the server yet.')
    if (!f.name || !f.brand || !f.serial || !f.purchaseDate || !f.duration || Number(f.duration) < 1) return setError('Complete all required fields with a valid warranty duration.')
    const ocr = form.ocr
    setBusy(true); setError('')
    try {
      await api.registerProduct({
        customer_id: session.customerId, name: f.name.trim(), brand: f.brand.trim(), category: categoryKey(f.category), serial_number: f.serial.trim(), purchase_date: f.purchaseDate,
        model: ocr?.extracted?.model ?? undefined, purchase_price: ocr?.extracted?.purchase_price ?? undefined, bill_url: ocr?.bill_url ?? undefined, ocr_data: ocr?.extracted ?? undefined,
        warranty: { duration_months: Number(f.duration), terms: f.notes?.trim() || undefined },
      })
      setModal(''); await load(session, true); notify('Product registered')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  // Optional bill upload: Gemini reads the bill on the server; we only prefill fields the person hasn't filled in.
  const scanBill = async (event) => {
    const file = event.target.files?.[0]
    if (!file || !formRef.current) return
    const typed = Object.fromEntries(new FormData(formRef.current)); delete typed.bill
    setError(''); setForm((f) => ({ ...f, ...typed, billStatus: 'Reading your bill…' }))
    try {
      const res = await api.scanBill(file); const x = res.extracted
      const fill = { name: x.product_name, brand: x.brand, serial: x.serial_number, purchaseDate: x.purchase_date, duration: x.warranty_months }
      const warn = [res.serial_already_registered && 'This serial number is already registered.', res.upload_warning].filter(Boolean).join(' ')
      setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(fill).filter(([k, v]) => v && !typed[k])), proof: file.name, ocr: { extracted: x, bill_url: res.bill_url }, billStatus: `Bill read — please check the details.${warn ? ` ${warn}` : ''}`, v: (f.v || 0) + 1 }))
    } catch (e) { setForm((f) => ({ ...f, ...typed, billStatus: `${e.message}`, v: (f.v || 0) + 1 })) }
  }
  const saveClaim = async (event) => {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget)); const p = products.find((x) => x.id === f.productId)
    if (!p || !f.issue.trim()) return setError('Choose a product and describe the issue.')
    setBusy(true); setError('')
    try {
      // No service type selected = the server triages the description (Gemini, with a rules fallback).
      const res = await api.submitClaim({ product_id: p.id, customer_id: session.customerId, description: f.issue.trim(), service_type: f.type || undefined })
      setModal(''); await load(session, true)
      notify(res.status === 'rejected' ? `Claim ${res.claim_number} was rejected: ${res.rejection_reason}` : `Claim ${res.claim_number} submitted`, res.status === 'rejected' ? 'error' : 'ok')
    } catch (e) { setError(e.code === 'DUPLICATE_CLAIM' && e.details?.claim_number ? `${e.message} (${e.details.claim_number})` : e.message) } finally { setBusy(false) }
  }
  // Staff transitions the server accepts via PATCH /claims/:id/status. Scheduling has its own form.
  const updateClaim = async (claim, status, note = '') => {
    const key = statusKey(status)
    if (!STAFF_STATUS_KEYS.includes(key)) return notify(`“${status}” can’t be set from here.`, 'error')
    const body = { status: key }
    if (key === 'rejected') body.rejection_reason = note || 'Rejected after team review.'
    else if (key === 'completed') body.resolution_notes = note || undefined
    else if (note) body.note = note
    try { await api.changeStatus(claim.uuid, body); await load(session, true); notify(`Claim moved to ${status}`) } catch (e) { notify(e.message, 'error') }
  }
  const chooseCenter = async (centerId) => {
    const center = data.centers.find((c) => c.id === centerId)
    if (!center) return setSlotState({ centerId: '', loading: false, options: [], error: '' })
    setSlotState({ centerId, loading: true, options: [], error: '' })
    try { const options = await loadOpenSlots(center); setSlotState((st) => (st.centerId === centerId ? { centerId, loading: false, options, error: '' } : st)) }
    catch (e) { setSlotState((st) => (st.centerId === centerId ? { centerId, loading: false, options: [], error: e.message } : st)) }
  }
  const schedule = async (event) => {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget)); const center = data.centers.find((c) => c.id === f.centerId)
    if (!center || !center.serviceTypes.includes(selected.serviceType)) return setError('This center does not support the selected service type.')
    if (!f.slot) return setError('Choose an available appointment slot.')
    setBusy(true); setError('')
    try { await api.schedule(selected.uuid, { service_center_id: center.id, scheduled_at: f.slot }); setModal(''); await load(session, true); notify('Appointment scheduled') }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const shownProducts = products.filter((p) => `${p.name} ${p.brand} ${p.category} ${p.serial}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All' || (filter === 'Active' ? expiry(p) >= TODAY : expiry(p) < TODAY)))
  const shownClaims = claims.filter((c) => `${c.id} ${c.issue} ${currentProduct(c)?.name || ''}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All' || c.status === filter))
  const isCustomer = role === 'Customer'
  const hub = session?.hub || ''
  const openDetails = (claim) => { setError(''); setSelected(claim); setModal('details') }
  const openSchedule = (claim) => { setError(''); setSlotState({ centerId: '', loading: false, options: [], error: '' }); setSelected(claim); setModal('schedule') }
  const resetView = () => { setPage('Overview'); setQuery(''); setFilter('All'); setModal(''); setError('') }
  const signIn = (type, { remember = true, hubName = '', customer } = {}) => { const next = { type, hub: hubName, ...(customer ? { customerId: customer.id, customerName: customer.name } : {}) }; writeSession(next, remember); setPhase('loading'); setLoadError(''); setSession(next); setRole(type === 'admin' ? 'Team Admin' : 'Customer'); resetView() }
  const signOut = () => { setAuthView(session?.type || 'customer'); writeSession(null); setStaffKey(''); setPhase('loading'); setLoadError(''); setSession(null); setRole('Customer'); setData((d) => ({ ...d, products: [], claims: [] })); resetView() }
  // Customers are identified by email; the server creates the record on first sign-in.
  const signInCustomer = async (remember, email, name) => { const customer = await api.upsertCustomer(name, email); signIn('customer', { remember, customer }) }
  // The "password" is the staff key: it's never bundled with the app, and the server decides if it's valid.
  const signInAdmin = async (hubName, staffKey) => {
    setStaffKey(staffKey)
    try { await api.stats() } catch (e) { setStaffKey(''); throw e instanceof ApiError && e.status === 401 ? new ApiError(401, e.code, 'The server did not accept that staff key.') : e }
    signIn('admin', { remember: false, hubName })
  }
  // Fetch whenever the signed-in person changes (load only sets state after the network calls resolve).
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { load(session) }, [session, load])
  // Next available appointments per center (shown on the Service centers page).
  const centerIds = data.centers.map((c) => c.id).join()
  useEffect(() => {
    if (page !== 'Service centers' || !centerIds) return
    let live = true
    data.centers.forEach((c) => loadOpenSlots(c).then((opts) => live && setData((d) => ({ ...d, centers: d.centers.map((x) => (x.id === c.id ? { ...x, slots: opts.map((o) => o.date), slotsLoaded: true } : x)) }))).catch(() => live && setData((d) => ({ ...d, centers: d.centers.map((x) => (x.id === c.id ? { ...x, slotsLoaded: true } : x)) }))))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, centerIds])
  useEffect(() => { document.title = session ? (isCustomer ? 'WarrantyVault' : 'WarrantyVault · Control room') : 'WarrantyVault · Sign in' }, [session, isCustomer])

  const toastEl = toast && <div className={`toast ${toastKind}`} role="status">{toastKind === 'error' ? '!' : '✓'} &nbsp;{toast}</div>
  if (!session) {
    return <>
      {authView === 'customer'
        ? <CustomerLogin products={products} notify={notify} onSwitch={() => setAuthView('admin')} onSignIn={signInCustomer} />
        : <AdminLogin centers={data.centers} claims={claims} products={products} serverError={phase === 'error' ? loadError : ''} onSwitch={() => setAuthView('customer')} onSignIn={signInAdmin} />}
      {toastEl}
    </>
  }

  const person = isCustomer ? [initials(session.customerName), session.customerName || 'You'] : staffPeople[role]
  const title = page === 'Overview' ? (isCustomer ? `Welcome back, ${(session.customerName || '').split(' ')[0] || 'there'}.` : 'Operations overview') : page
  const subtitle = page === 'Overview' ? (isCustomer ? 'Here’s what’s happening with your products.' : 'Your service operations at a glance.') : `Manage ${page.toLowerCase()} in one place.`
  const resolvedShare = claims.length ? Math.round((claims.filter((c) => CLOSED.includes(c.status)).length / claims.length) * 100) : 0
  const goTo = (name) => { setPage(name); setQuery(''); setFilter('All') }

  const footer = <footer className="footer"><span>© 2025 WarrantyVault</span><span>WARRANTIES ARE NOT VERIFIED WITH MANUFACTURERS</span><a href="#privacy" onClick={(e)=>{e.preventDefault();notify('Your products and claims are stored in the WarrantyVault database')}}>Privacy & data</a></footer>

  const customerExtras = <>
    <div className="dashboard-grid"><section className="panel activity-panel"><div className="panel-head"><div><h2>Recent activity</h2><p>Your latest warranty updates</p></div><button className="text-button" onClick={()=>setPage('Claims')}>View all →</button></div><div className="activity-list">{claims.slice(0,4).map((c,i)=><div className="activity-row" key={c.id}><div className={`activity-icon activity-${i%4}`}>{c.status==='Completed'?'✓':'◇'}</div><div className="activity-copy"><strong>{c.issue}</strong><span>{currentProduct(c)?.name} · {c.id}</span></div><Status value={c.status}/><time>{formatDate(c.updated)}</time></div>)}</div></section><ServicePanel claims={claims} productFor={currentProduct} onOpen={openDetails} onHistory={()=>setPage('Service history')}/></div>
    <section className="panel product-preview"><div className="panel-head"><div><h2>Your products</h2><p>Warranty coverage at a glance</p></div><button className="text-button" onClick={()=>setPage('My products')}>View all products →</button></div><ProductTable products={products.slice(0,3)} onEdit={(p)=>openModal('product',p)} onClaim={beginClaim}/></section>
  </>

  const pageBody = <>
    {page==='Overview'&&(isCustomer
      ? <><CustomerHome products={products} claims={claims} counts={counts} productFor={currentProduct} openModal={openModal} beginClaim={beginClaim} openDetails={openDetails}/>{customerExtras}</>
      : <AdminHome role={role} claims={claims} productFor={currentProduct} nextStatus={nextStatus} updateClaim={updateClaim} openDetails={openDetails} openSchedule={openSchedule} setPage={setPage}/>)}
      {page==='My products'&&<section className="panel table-panel"><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={['All','Active','Expired']} placeholder="Search products…"/><ProductTable products={shownProducts} onEdit={(p)=>openModal('product',p)} onClaim={beginClaim}/>{!shownProducts.length&&<Empty title="No products found" text="Try changing your search or register a product." action={()=>openModal('product')}/>}</section>}
      {(page==='Claims'||page==='Claims queue'||page==='Service history')&&<section className="panel table-panel"><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={page==='Service history'?['All','Completed','In Repair','Scheduled']:['All','Submitted','Under Review','Approved','Rejected','Cancelled','Scheduled','In Repair','Completed']} placeholder="Search claims or products…"/><ClaimTable claims={page==='Service history'?shownClaims.filter((c)=>['Completed','In Repair','Scheduled'].includes(c.status)):shownClaims} productFor={currentProduct} onOpen={(c)=>{setSelected(c);setModal('details')}} onStatus={updateClaim} onSchedule={(c)=>{setSelected(c);setModal('schedule')}} staff={role!=='Customer'}/>{!shownClaims.length&&<Empty title="No claims to show" text="Submitted claims and service updates will appear here." action={role==='Customer'?()=>beginClaim():null}/>}</section>}
      {page==='Service centers'&&<section className="center-grid">{data.centers.map((c)=><article className="panel center-card" key={c.id}><div className="center-top"><span className="center-icon">⌖</span><span className="availability"><i/> Accepting appointments</span></div><h2>{c.name}</h2><p>⌖ {c.city}</p><div className="eyebrow">SUPPORTED SERVICES</div><div className="chips">{c.types.map((t)=><span key={t}>{t}</span>)}</div><div className="center-bottom"><span>Next available <strong>{c.slotsLoaded?formatDate(c.slots[0]):'…'}</strong></span><span>{c.slotsLoaded?`${c.slots.length} open slots`:'Checking…'}</span></div></article>)}</section>}
      {page==='Team members'&&<section className="panel table-panel"><div className="panel-head team-head"><div><h2>Your service team</h2><p>People keeping every claim moving</p></div><button className="primary-button" onClick={()=>setToast('Team member invitations are demo-only')}>＋ Invite member</button></div><div className="team-list">{data.team.map((member)=> <div className="team-row" key={member.id}><div className="avatar">{member.name.split(' ').map((x)=>x[0]).join('')}</div><div className="team-person"><strong>{member.name}</strong><span>{member.role}</span></div><span className="assignment-count">{member.assigned} <small>active claims</small></span><span className="member-active"><i/> Active</span><button className="panel-more" aria-label={`Options for ${member.name}`}>···</button></div>)}</div></section>}
  </>

  const headingActions = <>
    {isCustomer&&page==='Overview'&&<button className="primary-button" onClick={()=>beginClaim()}><Icon name="wrench" size={16}/> Get service</button>}
    {page==='My products'&&<button className="primary-button" onClick={()=>openModal('product')}><Icon name="plus" size={16}/> Add a product</button>}
    {(page==='Claims'||page==='Claims queue')&&isCustomer&&<button className="primary-button" onClick={()=>beginClaim()}><Icon name="plus" size={16}/> Submit a claim</button>}
  </>

  const overlays = <>
    {toast&&<div className={`toast ${toastKind}`} role="status">{toastKind === 'error' ? '!' : '✓'} &nbsp;{toast}</div>}{modal&&<div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setModal('')}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><div className="eyebrow">WARRANTYVAULT</div><h2 id="modal-title">{modal==='product'?form.id?'Edit product':'Register a product':modal==='claim'?'Submit a claim':modal==='schedule'?'Schedule service':'Claim details'}</h2></div><button className="close-button" aria-label="Close" onClick={()=>setModal('')}>×</button></div>
      {modal==='product'&&<form key={form.v || 0} ref={formRef} onSubmit={saveProduct} className="form-grid"><Field label="Product name" name="name" value={form.name}/><Field label="Brand" name="brand" value={form.brand}/><Field label="Category" name="category" value={form.category} placeholder="Electronics, Home…"/><Field label="Serial number" name="serial" value={form.serial}/><Field label="Purchase date" name="purchaseDate" type="date" value={form.purchaseDate} max={TODAY}/><Field label="Warranty (months)" name="duration" type="number" value={form.duration} min="1"/><label className="field">Proof of purchase (optional)<input name="bill" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={scanBill} disabled={Boolean(form.id)}/><small>{form.billStatus || (form.id ? form.proof : 'Upload a bill and we’ll read the details for you.')}</small></label><label className="field full-field">Notes<textarea name="notes" defaultValue={form.notes} rows="3"/></label><div className="form-foot"><span className="form-hint">Expiry is calculated from purchase date and duration.</span><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save product'}</button></div></form>}
      {modal==='claim'&&<form onSubmit={saveClaim} className="form-grid"><label className="field full-field">Product<select name="productId" defaultValue={form.productId} required><option value="">Select a product</option>{products.map((p)=><option value={p.id} key={p.id}>{p.brand} {p.name} · {p.serial}</option>)}</select></label><label className="field">Service type<select name="type" defaultValue={form.type}><option value="">Let us work it out from your description</option>{meta.serviceTypes.map((t)=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label><div className="eligibility-note">◉ <span>Eligibility is checked against the warranty dates and coverage on record, not verified with the manufacturer.</span></div><label className="field full-field">Describe the issue<textarea name="issue" rows="4" defaultValue={form.issue} placeholder="Tell us what happened…" required/></label><p className="form-hint full-field">A product can’t have two open claims for the same issue.</p><div className="form-foot full-field"><span/><button className="primary-button" disabled={busy}>{busy?'Submitting…':'Submit claim'}</button></div></form>}
      {modal==='schedule'&&selected&&<form onSubmit={schedule} className="form-grid"><div className="context-card full-field"><strong>{selected.id} · {selected.issue}</strong><span>{currentProduct(selected)?.name} · {selected.type}</span></div><label className="field full-field">Service center<select name="centerId" value={slotState.centerId} onChange={(e)=>chooseCenter(e.target.value)} required><option value="">Choose a compatible center</option>{data.centers.map((c)=><option key={c.id} value={c.id} disabled={!c.serviceTypes.includes(selected.serviceType)}>{c.name} · {c.city}{!c.serviceTypes.includes(selected.serviceType)?' (unavailable for this service)':''}</option>)}</select></label><label className="field full-field">Appointment slot<select name="slot" defaultValue="" required disabled={!slotState.centerId||slotState.loading}><option value="">{slotState.loading?'Checking availability…':slotState.centerId?(slotState.options.length?'Select a slot':'No open slots in the next 7 days'):'Choose a center first'}</option>{slotState.options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select><small>{slotState.error||'Availability is checked again when you save.'}</small></label><div className="form-foot full-field"><span/><button className="primary-button" disabled={busy}>{busy?'Scheduling…':'Confirm appointment'}</button></div></form>}
      {modal==='details'&&selected&&<><div className="detail-summary"><div><span>CLAIM ID</span><strong>{selected.id}</strong></div><div><span>STATUS</span><Status value={selected.status}/></div><div><span>PRODUCT</span><strong>{currentProduct(selected)?.brand} {currentProduct(selected)?.name}</strong></div><div><span>ISSUE</span><strong>{selected.issue}</strong></div>{selected.center&&<div><span>SERVICE VISIT</span><strong>{selected.center} · {formatDate(selected.slot)}</strong></div>}</div><div className="timeline-title">Claim timeline</div><div className="timeline">{selected.history.map((h,i)=><div className="timeline-item" key={`${h.status}-${i}`}><span className={`timeline-dot ${i===selected.history.length-1?'current':''}`}/><div><strong>{h.status}</strong><time>{formatDate(h.date)}</time><p>{h.note}</p></div></div>)}</div>{selected.notes&&<div className="notes-box"><strong>Service notes</strong><p>{selected.notes}</p></div>}<div className="modal-actions">{role!=='Customer'&&selected.status==='Approved'&&<button className="primary-button" onClick={()=>openSchedule(selected)}>Schedule service</button>}{role!=='Customer'&&nextStatus[selected.status]&&selected.status!=='Approved'&&<button className="primary-button" onClick={()=>{updateClaim(selected,nextStatus[selected.status]);setModal('')}}>Move to {nextStatus[selected.status]}</button>}{role!=='Customer'&&['Submitted','Under Review'].includes(selected.status)&&<button className="outline-button reject-button" onClick={()=>{updateClaim(selected,'Rejected','Rejected after team review.');setModal('')}}>Reject claim</button>}<button className="outline-button" onClick={()=>setModal('')}>Close</button></div></>}
      {error&&<div className="error-message" role="alert">{error}</div>}</section></div>}
  </>

  return <div className={`app ${isCustomer ? 'theme-customer' : 'theme-admin'}`}>
    {isCustomer ? <header className="c-top"><div className="c-top-inner">
      <a className="c-brand" href="#home" onClick={(e)=>{e.preventDefault();goTo('Overview')}}><span className="c-brand-mark"><Icon name="key" size={18}/></span><span><b>WarrantyVault</b><small>CARE, MADE SIMPLE</small></span></a>
      <nav className="c-nav" aria-label="Main navigation">{nav.Customer.map(([name])=><button key={name} className={`c-nav-link ${page===name?'active':''}`} aria-current={page===name?'page':undefined} onClick={()=>goTo(name)}>{customerLabels[name]}</button>)}</nav>
      <div className="c-actions"><button className="mint-btn" onClick={()=>openModal('product')}><Icon name="plus" size={16}/> Add product</button><button className="icon-btn" aria-label="Contact support" onClick={()=>notify('Support: hello@warrantyvault.demo')}><Icon name="help" size={18}/></button><button className="icon-btn" aria-label="Notifications" onClick={()=>notify('You’re all caught up')}><Icon name="bell" size={18}/><i/></button><div className="avatar" title={person[1]}>{person[0]}</div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={signOut}><Icon name="log-out" size={18}/></button></div>
    </div></header>
    : <aside className="a-side">
      <a className="a-brand" href="#home" onClick={(e)=>{e.preventDefault();setPage('Overview')}}><span className="a-brand-mark"><Icon name="shield-check" size={18}/></span><span><b>WarrantyVault</b><small>CONTROL ROOM</small></span></a>
      <nav aria-label="Main navigation">{adminGroups.map(([label,items])=>{const shown=items.filter((n)=>nav[role].some(([name])=>name===n));return shown.length?<div className="nav-group" key={label}><div className="nav-caption">{label}</div>{shown.map((name)=><button key={name} className={`nav-link ${page===name?'active':''}`} aria-current={page===name?'page':undefined} onClick={()=>goTo(name)}><Icon name={adminIcons[name]} size={16}/>{name}{name==='Claims queue'&&<b className="nav-count">{counts.open}</b>}</button>)}</div>:null})}</nav>
      <div className="a-side-bottom"><div className="health"><div className="health-top"><span>CLAIMS RESOLVED</span><b>{resolvedShare}%</b></div><div className="health-bar"><i style={{width:`${resolvedShare}%`}}/></div></div><div className="demo-note">LIVE DATA <span>•</span> Synced with the server</div></div>
    </aside>}
    <main className={isCustomer?'c-main':'a-main'}>
      {!isCustomer&&<header className="a-top">
        <label className="a-search"><Icon name="search" size={15}/><input value={adminSearch} onChange={(e)=>setAdminSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){setPage('Claims queue');setFilter('All');setQuery(adminSearch);setAdminSearch('')}}} placeholder="Search claims…" aria-label="Search claims"/></label>
        <div className="breadcrumbs">Control room <span>/</span> <strong>{page}</strong></div>
        <div className="a-top-actions"><div className="seg" role="group" aria-label="Team role">{['Team Admin','Team Leader'].map((r)=><button key={r} className={role===r?'on':''} aria-pressed={role===r} onClick={()=>{setRole(r);goTo('Overview')}}>{r}</button>)}</div>{hub&&<span className="hub-pill"><i/> {hub}</span>}<button className="icon-btn" aria-label="Notifications" onClick={()=>notify('You’re all caught up')}><Icon name="bell" size={17}/><i/></button><div className="user-chip"><div className="avatar">{person[0]}</div><span><strong>{person[1]}</strong><small>{role}</small></span></div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={signOut}><Icon name="log-out" size={17}/></button></div>
      </header>}
      <div className={isCustomer?'c-content':'a-content'}>
        <section className="page-heading"><div><div className="eyebrow">{new Date(TODAY + 'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase()}</div><h1>{title}</h1><p>{subtitle}</p></div>{headingActions}</section>
        {phase==='ready'?pageBody:<section className="panel"><div className="empty"><span>◇</span><strong>{phase==='error'?'Can’t load your data':'Loading your data…'}</strong><p>{phase==='error'?loadError:'Fetching the latest from WarrantyVault.'}</p>{phase==='error'&&<button className="outline-button" onClick={()=>{setPhase('loading');setLoadError('');load(session)}}>Try again</button>}</div></section>}
        {footer}
      </div>
    </main>
    {overlays}
  </div>
}

function Toolbar({query,setQuery,filter,setFilter,options,placeholder}) { return <div className="toolbar"><label className="searchbox"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder}/></label><label className="filterbox"><span>☷</span><select value={filter} onChange={(e)=>setFilter(e.target.value)} aria-label="Filter records">{options.map((x)=><option key={x}>{x}</option>)}</select></label></div> }
function ProductTable({products,onEdit,onClaim}) { if(!products.length)return <Empty title="No products registered" text="Add products to keep their purchase details and warranty coverage together." onClick={onEdit}/>; return <div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>SERIAL NUMBER</th><th>PURCHASED</th><th>WARRANTY ENDS</th><th>STATUS</th><th/></tr></thead><tbody>{products.map((p)=><tr key={p.id}><td><div className="product-cell"><span className="product-thumb">{p.category==='Kitchen'?'♨':p.category==='Home'?'⌂':'▣'}</span><span><strong>{p.name}</strong><small>{p.brand} · {p.category||'Product'}</small></span></div></td><td className="serial-cell">{p.serial}</td><td>{formatDate(p.purchaseDate)}</td><td>{formatDate(expiry(p))}</td><td><Warranty product={p}/></td><td><div className="row-actions"><button aria-label={`Start claim for ${p.name}`} title="New claim" onClick={()=>onClaim(p)}>◇</button><button aria-label={`Edit ${p.name}`} title="Edit product" onClick={()=>onEdit(p)}>↗</button></div></td></tr>)}</tbody></table></div> }
function Warranty({product}) { const end=expiry(product);const today=TODAY; if(!end)return <Status value="Under Review"/>;return <span className={`warranty ${end<today?'expired':''}`}><i/>{end<today?'Expired':'Active'}</span> }
function ClaimTable({claims,productFor,onOpen,onStatus,onSchedule,staff}) { if(!claims.length)return <Empty title="No claims found" text="Try another filter or search term."/>;return <div className="table-scroll"><table><thead><tr><th>CLAIM</th><th>PRODUCT</th><th>ISSUE</th><th>SUBMITTED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{claims.map((c)=><tr key={c.id}><td><button className="claim-id" onClick={()=>onOpen(c)}>{c.id}</button></td><td><strong>{productFor(c)?.name||'Unknown product'}</strong><small className="subcell">{productFor(c)?.brand}</small></td><td className="issue-cell">{c.issue}</td><td>{formatDate(c.submitted)}</td><td><Status value={c.status}/></td><td>{staff&&c.status==='Approved'?<button className="table-action" onClick={()=>onSchedule(c)}>Schedule →</button>:staff&&nextStatus[c.status]&&c.status!=='Approved'?<button className="table-action" onClick={()=>onStatus(c,nextStatus[c.status])}>{nextStatus[c.status]} →</button>:<button className="row-action-single" aria-label="View claim" onClick={()=>onOpen(c)}>↗</button>}<button className="row-action-single" aria-label="View timeline" onClick={()=>onOpen(c)}> ···</button></td></tr>)}</tbody></table></div> }
function Field({label,name,value,type='text',placeholder,min,max}) { return <label className="field">{label}<input name={name} type={type} defaultValue={value||''} placeholder={placeholder} min={min} max={max} required/></label> }

export default App
