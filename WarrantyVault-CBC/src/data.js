// The backend has no team-member endpoint, so this list is still static display data.
export const team = [{ id: 't1', name: 'Maya Chen', role: 'Team Leader', assigned: 8 }, { id: 't2', name: 'Jordan Lee', role: 'Claims Specialist', assigned: 14 }, { id: 't3', name: 'Sam Rivera', role: 'Service Coordinator', assigned: 11 }]

// Warranty end date: the backend's own value when present, otherwise purchase date + duration.
export function expiry(product) {
  if (product.warrantyEnd) return product.warrantyEnd
  const date = new Date(product.purchaseDate)
  if (!product.purchaseDate || Number.isNaN(date.getTime()) || !Number.isFinite(Number(product.duration))) return null
  date.setMonth(date.getMonth() + Number(product.duration))
  return date.toISOString().slice(0, 10)
}
export const formatDate = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
