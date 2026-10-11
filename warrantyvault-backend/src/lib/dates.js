const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is earlier. */
export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function addMonths(s, months) {
  const [y, m, d] = s.split('-').map(Number);
  const idx = m - 1 + months;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Today's calendar date (YYYY-MM-DD) in the service-center timezone. */
export const todayInTz = (now, offsetMinutes) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
