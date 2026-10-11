// Appointment grid: hourly slots 10:00-17:00 (service-center local time), every day.
export const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

/** All slot start instants for a local calendar date (YYYY-MM-DD). */
export function slotsForDate(dateStr, offsetMinutes) {
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`);
  return SLOT_HOURS.map((h) => {
    const ms = midnightUtc + (h * 60 - offsetMinutes) * 60_000;
    return { start: new Date(ms).toISOString(), label: `${String(h).padStart(2, '0')}:00` };
  });
}

export const localDateOfInstant = (iso, offsetMinutes) =>
  new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);

export function isValidSlot(iso, offsetMinutes) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const date = localDateOfInstant(iso, offsetMinutes);
  return slotsForDate(date, offsetMinutes).some((s) => Date.parse(s.start) === ms);
}

/** [startIso, endIso) covering one local day, for DB range queries. */
export function dayRange(dateStr, offsetMinutes) {
  const start = Date.parse(`${dateStr}T00:00:00Z`) - offsetMinutes * 60_000;
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()];
}
