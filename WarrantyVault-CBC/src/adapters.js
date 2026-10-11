// Maps backend records to the shapes the existing UI components already render, so the
// components themselves stay unchanged. Display names (statuses, categories) live here.
const pad = (n) => String(n).padStart(2, '0')
const utcDay = (iso) => (iso ? String(iso).slice(0, 10) : '')
// Appointments are shown in the viewer's local time (service centers use the same grid: 10:00-17:00).
const localDay = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const localTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')

const STATUS_LABEL = { submitted: 'Submitted', validated: 'Under Review', approved: 'Approved', scheduled: 'Scheduled', in_repair: 'In Repair', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' }
export const statusLabel = (key) => STATUS_LABEL[key] ?? key
export const statusKey = (label) => Object.keys(STATUS_LABEL).find((k) => STATUS_LABEL[k] === label)
export const CLOSED = ['Completed', 'Rejected', 'Cancelled']

const CATEGORY_LABEL = { mobile: 'Mobile', laptop: 'Laptop', tv: 'TV', refrigerator: 'Refrigerator', washing_machine: 'Washing machine', air_conditioner: 'Air conditioner', audio: 'Audio', kitchen_appliance: 'Kitchen', other: 'Other' }
const CATEGORY_HINTS = [
  ['kitchen_appliance', /kitchen|mixer|blender|oven|cook|coffee|toaster/], ['mobile', /mobile|phone/], ['laptop', /laptop|computer|notebook/],
  ['tv', /\btv\b|television/], ['refrigerator', /fridge|refrigerat/], ['washing_machine', /wash/], ['air_conditioner', /air.?con|\bac\b/], ['audio', /audio|headphone|speaker|earbud|sound/],
]
// The product form takes a free-text category; the backend accepts a fixed list, anything else is "other".
export function categoryKey(text = '') {
  const t = String(text).trim().toLowerCase().replaceAll(' ', '_')
  if (CATEGORY_LABEL[t]) return t
  const loose = String(text).toLowerCase()
  return CATEGORY_HINTS.find(([, re]) => re.test(loose))?.[0] ?? 'other'
}

const monthsBetween = (from, to) => {
  if (!from || !to) return 0
  const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1)
}

export function toProduct(raw) {
  const w = raw.warranty
  return {
    id: raw.id,
    name: raw.name,
    brand: raw.brand,
    category: CATEGORY_LABEL[raw.category] ?? 'Other',
    serial: raw.serial_number,
    purchaseDate: raw.purchase_date,
    duration: monthsBetween(w?.start_date ?? raw.purchase_date, w?.end_date),
    warrantyEnd: w?.end_date ?? null,
    proof: raw.bill_url ? decodeURIComponent(raw.bill_url.split('/').pop().split('?')[0]).replace(/^[0-9a-f-]{36}-/i, '') : '',
    billUrl: raw.bill_url ?? null,
    // The backend has no free-text product notes; the registration form's notes are stored as the warranty terms.
    notes: w?.terms ?? '',
  }
}

const toEvent = (e, hideRisk) => ({
  status: statusLabel(e.status),
  date: utcDay(e.created_at),
  // Internal risk scoring is not shown to customers.
  note: (hideRisk ? String(e.note ?? '').replace(/\s*Fraud risk:.*$/s, '') : e.note) || e.title,
})

export function toClaim(raw, labels = {}, { hideRisk = false } = {}) {
  const p = raw.product
  const events = raw.timeline ?? []
  return {
    id: raw.claim_number, // shown in the UI
    uuid: raw.id, // used for API calls
    productId: raw.product_id,
    product: p ? { id: p.id, name: p.name, brand: p.brand, serial: p.serial_number, category: CATEGORY_LABEL[p.category] ?? 'Other' } : null,
    issue: raw.description,
    type: labels[raw.service_type] ?? raw.service_type,
    serviceType: raw.service_type,
    status: statusLabel(raw.status),
    submitted: utcDay(raw.created_at),
    updated: utcDay(raw.updated_at ?? raw.created_at),
    center: raw.service_center?.name ?? '',
    slot: localDay(raw.scheduled_at),
    slotTime: localTime(raw.scheduled_at),
    notes: raw.resolution_notes || raw.rejection_reason || '',
    history: events.map((e) => toEvent(e, hideRisk)),
    hasHistory: events.length > 0,
  }
}

export function toCenter(raw, labels = {}) {
  return {
    id: raw.id,
    name: raw.name,
    city: raw.city,
    address: raw.address,
    serviceTypes: raw.supported_services ?? [],
    types: (raw.supported_services ?? []).map((s) => labels[s] ?? s),
    technicians: raw.technicians,
    slots: [], // loaded on demand from /service-centers/:id/slots
  }
}

export function toSlotOption(centerName, slot) {
  const d = new Date(slot.start)
  return { value: slot.start, date: localDay(slot.start), label: `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${localTime(slot.start)} · ${centerName}` }
}
