import { HttpError } from './errors.js';

export function dbError(error) {
  if (error instanceof HttpError) return error;
  const msg = error?.message || String(error);
  if (error?.code === '23505') return new HttpError(409, 'CONFLICT', 'Record already exists', { detail: msg });
  if (error?.code === '23503') return new HttpError(400, 'INVALID_REFERENCE', 'Referenced record does not exist', { detail: msg });
  if (error?.code === '22P02') return new HttpError(400, 'VALIDATION_ERROR', 'Invalid id or value format', { detail: msg });
  if (error?.code === 'PGRST116') return new HttpError(404, 'NOT_FOUND', 'Record not found');
  if (error?.code === 'PGRST205' || error?.code === '42P01' || /schema cache|does not exist/i.test(msg)) {
    return new HttpError(500, 'SCHEMA_MISSING', 'Table not found. Run supabase/schema.sql in the Supabase SQL editor.', { detail: msg });
  }
  if (/invalid api key|jwt/i.test(msg)) {
    return new HttpError(500, 'SUPABASE_AUTH', 'Supabase rejected the key. Use the service_role key in SUPABASE_SERVICE_ROLE_KEY.', { detail: msg });
  }
  if (/fetch failed/i.test(msg)) {
    return new HttpError(500, 'SUPABASE_UNREACHABLE', 'Could not reach Supabase. Check SUPABASE_URL.', { detail: msg });
  }
  return new HttpError(500, 'DB_ERROR', msg);
}

/** Unwrap a supabase-js result: throws a friendly HttpError on error, returns data otherwise. */
export function check(result) {
  if (result?.error) throw dbError(result.error);
  return result?.data;
}
