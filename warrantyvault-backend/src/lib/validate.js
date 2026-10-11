import { HttpError } from './errors.js';

export const bad = (message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);

export function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj?.[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');
  if (missing.length) throw bad(`Missing required field(s): ${missing.join(', ')}`, { missing });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export function requireUuid(v, name) {
  if (!isUuid(v)) throw bad(`${name} must be a valid id (uuid)`);
  return v;
}

export const clean = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);
export const normalizeSerial = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
