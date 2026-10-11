// Shared date helpers. TODAY is computed the same way data.js seeds its demo dates.
export const TODAY = new Date().toISOString().slice(0, 10)
export const IN_90_DAYS = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)

const noon = (date) => new Date(`${date}T12:00:00`)
export const daysUntil = (date) => Math.round((noon(date) - noon(TODAY)) / 86400000)
export const daysBetween = (from, to) => Math.round((noon(to) - noon(from)) / 86400000)
export const relativeDay = (date) => {
  const ago = -daysUntil(date)
  return ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${ago}d ago`
}
