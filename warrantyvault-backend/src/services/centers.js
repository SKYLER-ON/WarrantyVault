import { HttpError } from '../lib/errors.js';
import { check } from '../lib/db-helpers.js';
import { bad, requireUuid } from '../lib/validate.js';
import { isDateStr, todayInTz } from '../lib/dates.js';
import { dayRange, slotsForDate } from '../lib/slots.js';
import { SERVICE_TYPES } from '../lib/rules.js';

const BOOKED_STATUSES = ['scheduled', 'in_repair'];

export function createCenterService({ db, config, now }) {
  async function list({ service_type, city } = {}) {
    if (service_type && !SERVICE_TYPES[service_type]) throw bad(`service_type must be one of: ${Object.keys(SERVICE_TYPES).join(', ')}`);
    let centers = check(await db.from('service_centers').select('*').eq('is_active', true).order('name', { ascending: true }));
    if (city) centers = centers.filter((c) => c.city.toLowerCase() === String(city).toLowerCase());
    if (service_type) centers = centers.filter((c) => c.supported_services.includes(service_type));
    return centers;
  }

  async function get(id) {
    requireUuid(id, 'service center id');
    const c = check(await db.from('service_centers').select('*').eq('id', id).maybeSingle());
    if (!c) throw new HttpError(404, 'CENTER_NOT_FOUND', 'Service center not found');
    return c;
  }

  /** Appointment slots for a day with remaining capacity (one slot = `technicians` parallel jobs). */
  async function slots(centerId, date) {
    const center = await get(centerId);
    const day = date ?? todayInTz(now(), config.tzOffsetMinutes);
    if (!isDateStr(day)) throw bad('date must be YYYY-MM-DD');
    const [from, to] = dayRange(day, config.tzOffsetMinutes);
    const booked = check(
      await db
        .from('claims')
        .select('scheduled_at')
        .eq('service_center_id', center.id)
        .in('status', BOOKED_STATUSES)
        .gte('scheduled_at', from)
        .lt('scheduled_at', to),
    );
    const counts = new Map();
    for (const b of booked) {
      const k = Date.parse(b.scheduled_at);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const nowMs = now().getTime();
    return {
      center: { id: center.id, name: center.name, technicians: center.technicians },
      date: day,
      slots: slotsForDate(day, config.tzOffsetMinutes).map((s) => {
        const used = counts.get(Date.parse(s.start)) || 0;
        const remaining = Math.max(0, center.technicians - used);
        return { ...s, booked: used, remaining, available: Date.parse(s.start) > nowMs && remaining > 0 };
      }),
    };
  }

  return { list, get, slots };
}
