import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { HttpError } from './lib/errors.js';

/** Supabase client using the service_role key (backend only). Starts even if keys are missing. */
export function createDb({ supabaseUrl, supabaseKey }) {
  if (!supabaseUrl || !supabaseKey) {
    const fail = () => {
      throw new HttpError(503, 'DB_NOT_CONFIGURED', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, then restart.');
    };
    return { configured: false, from: fail, storage: { from: fail } };
  }
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  client.configured = true;
  return client;
}

/** Upload a bill to the public "bills" bucket and return its URL. */
export async function uploadBill(db, bucket, buffer, mimeType, originalName = 'bill') {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
  const { error } = await db.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(error.message);
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
