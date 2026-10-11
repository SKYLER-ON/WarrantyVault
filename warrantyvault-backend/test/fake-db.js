// Minimal in-memory stand-in for the supabase-js query builder (only what the services use).
import crypto from 'node:crypto';

const OPEN = ['submitted', 'validated', 'approved', 'scheduled', 'in_repair'];
const ISO = /^\d{4}-\d{2}-\d{2}T/;
const same = (a, b) => (typeof a === 'string' && typeof b === 'string' && ISO.test(a) && ISO.test(b) ? Date.parse(a) === Date.parse(b) : a === b);
const cmp = (a, b) => (typeof a === 'string' && ISO.test(a) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);

export function createFakeDb(clock = () => new Date()) {
  const tables = { customers: [], products: [], warranties: [], service_centers: [], claims: [], claim_events: [] };
  const unique = { customers: ['email'], products: ['serial_number'], claims: ['claim_number'], warranties: ['product_id'] };
  const defaults = {
    products: { bill_verified: false, category: 'other' },
    service_centers: { technicians: 2, is_active: true },
    claims: { fraud_score: 0, fraud_reasons: [], requires_manual_review: false, technician: null },
  };

  class Q {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.payload = null; this.mode = null; this.orderBy = null; this.returning = false; }
    select() { if (this.op !== 'select') this.returning = true; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => same(r[c], v)); return this; }
    neq(c, v) { this.filters.push((r) => !same(r[c], v)); return this; }
    in(c, vs) { this.filters.push((r) => vs.some((v) => same(r[c], v))); return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
    order(c, { ascending = true } = {}) { this.orderBy = [c, ascending]; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    // supabase-js: .single() errors unless exactly one row
    single() { this.mode = 'one'; return this; }
    then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }

    exec() {
      const rows = tables[this.table];
      const match = (r) => this.filters.every((f) => f(r));
      let out;
      if (this.op === 'insert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        out = [];
        for (const item of list) {
          const row = { id: crypto.randomUUID(), created_at: clock().toISOString(), ...(defaults[this.table] || {}), ...item };
          if (this.table === 'claims') row.updated_at = row.created_at;
          for (const col of unique[this.table] || []) {
            if (rows.some((r) => r[col] === row[col])) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${col})` } };
          }
          if (this.table === 'claims' && OPEN.includes(row.status) && rows.some((r) => r.product_id === row.product_id && r.service_type === row.service_type && OPEN.includes(r.status))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uniq_open_claim"' } };
          }
          rows.push(row);
          out.push(row);
        }
      } else if (this.op === 'update') {
        out = rows.filter(match);
        out.forEach((r) => Object.assign(r, this.payload, this.table === 'claims' ? { updated_at: clock().toISOString() } : {}));
      } else if (this.op === 'delete') {
        out = rows.filter(match);
        tables[this.table] = rows.filter((r) => !match(r));
      } else {
        out = rows.filter(match);
      }
      if (this.orderBy) {
        const [c, asc] = this.orderBy;
        out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]));
      }
      out = out.map((r) => structuredClone(r));
      if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
      if (this.mode === 'one') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: this.op === 'select' || this.returning ? out : null, error: null };
    }
  }
  return { configured: true, tables, from: (t) => new Q(t) };
}
