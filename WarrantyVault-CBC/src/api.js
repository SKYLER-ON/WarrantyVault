// Central API client for the WarrantyVault backend. All server calls go through here.
// The base URL comes from VITE_API_BASE_URL (see .env.example). No server secrets live in this file:
// the staff key is typed in by the service team at sign-in and only kept for the browser session.
const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/+$/, '')
const STAFF_STORE = 'warrantyvault-staff-key'

let staffKey = ''
try { staffKey = sessionStorage.getItem(STAFF_STORE) || '' } catch { /* storage unavailable */ }

export function setStaffKey(value) {
  staffKey = value || ''
  try { if (staffKey) sessionStorage.setItem(STAFF_STORE, staffKey); else sessionStorage.removeItem(STAFF_STORE) } catch { /* ignore */ }
}
export const hasStaffKey = () => Boolean(staffKey)

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(path, { method = 'GET', body, form, staff = false } = {}) {
  const headers = {}
  if (staff) {
    if (!staffKey) throw new ApiError(401, 'STAFF_ONLY', 'Service team sign-in is required.')
    headers['x-staff-key'] = staffKey
  }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the WarrantyVault server. Check that the backend is running.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error?.code, data?.error?.message || `Request failed (${res.status}).`, data?.error?.details)
  return data
}

const qs = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return q.size ? `?${q}` : ''
}

export const api = {
  meta: () => request('/meta'),
  // Customers: the backend identifies a customer by email (create-or-fetch).
  upsertCustomer: (name, email) => request('/customers', { method: 'POST', body: { name, email } }),
  // Products + warranties
  listProducts: (customerId) => request(`/products${qs({ customer_id: customerId })}`),
  registerProduct: (body) => request('/products', { method: 'POST', body }),
  // AI: bill OCR (multipart field "bill")
  scanBill: (file) => { const form = new FormData(); form.append('bill', file); return request('/ocr/bill', { method: 'POST', form }) },
  // Claims
  listClaims: ({ customerId } = {}) => (customerId ? request(`/claims${qs({ customer_id: customerId })}`) : request('/claims', { staff: true })),
  getClaim: (id) => request(`/claims/${id}`),
  submitClaim: (body) => request('/claims', { method: 'POST', body }),
  changeStatus: (id, body) => request(`/claims/${id}/status`, { method: 'PATCH', body, staff: true }),
  schedule: (id, body) => request(`/claims/${id}/schedule`, { method: 'POST', body, staff: true }),
  // Service centers + dashboard
  listCenters: () => request('/service-centers'),
  centerSlots: (id, date) => request(`/service-centers/${id}/slots${qs({ date })}`),
  stats: () => request('/dashboard/stats', { staff: true }),
}
