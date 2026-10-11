// End-to-end claim workflow through the real service layer, against an in-memory fake database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';
import { createServices } from '../src/services/index.js';
import { createAi } from '../src/gemini.js';
import { addDays } from '../src/lib/dates.js';
import { slotsForDate } from '../src/lib/slots.js';

const config = { tzOffsetMinutes: 330 };
const NOW = new Date('2026-10-10T11:00:00Z'); // 16:30 IST, Sat
const T = '2026-10-10';

async function setup() {
  const db = createFakeDb(() => NOW);
  const ai = createAi({ geminiKey: '', geminiModel: 'x' }); // AI off -> rule-based fallbacks
  const s = createServices({ db, ai, config, now: () => NOW });
  const cust = await s.products.upsertCustomer({ name: 'Demo', email: 'Demo@Example.com' });
  const other = await s.products.upsertCustomer({ name: 'Other', email: 'other@example.com' });
  const phoneCenter = db.tables.service_centers; // seed centers directly
  const mk = (row) => { const r = { id: crypto.randomUUID(), created_at: NOW.toISOString(), technicians: 2, is_active: true, ...row }; phoneCenter.push(r); return r; };
  const hub = mk({ name: 'Hub', city: 'Bengaluru', supported_services: ['general_repair', 'screen_repair', 'motor_repair', 'cooling_repair'] });
  const phoneShop = mk({ name: 'Phone Shop', city: 'Bengaluru', supported_services: ['screen_repair', 'battery_replacement'], technicians: 1 });
  const reg = (over = {}) => s.products.registerProduct({
    customer_id: cust.id, name: 'Galaxy S24', brand: 'Samsung', category: 'mobile', serial_number: `SER${Math.random().toString(36).slice(2, 10)}`,
    purchase_date: addDays(T, -60), warranty: { duration_months: 12 }, bill_url: 'https://x/bill.png', ...over,
  });
  return { db, s, cust, other, hub, phoneShop, reg };
}
const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && (!code || e.code === code), `expected ${status} ${code ?? ''}`);

test('customers: email is the login, case-insensitive, no duplicates', async () => {
  const { s, cust } = await setup();
  assert.equal(cust.email, 'demo@example.com');
  const again = await s.products.upsertCustomer({ name: 'Demo', email: 'DEMO@example.com' });
  assert.equal(again.id, cust.id);
  assert.equal(again.created, false);
});

test('product registration: warranty computed, OCR cross-check, duplicate serial blocked', async () => {
  const { s, reg } = await setup();
  const p = await reg({ serial_number: 'abc 12345', ocr_data: { serial_number: 'ABC12345', purchase_date: addDays(T, -60) } });
  assert.equal(p.serial_number, 'ABC12345');
  assert.equal(p.bill_verified, true);
  assert.equal(p.warranty.status, 'active');
  assert.equal(p.warranty.end_date, addDays(T, -60).replace(/^2026/, '2027'));
  await rejects(reg({ serial_number: 'ABC12345' }), 409, 'DUPLICATE_SERIAL');
  const mismatch = await reg({ ocr_data: { serial_number: 'DIFFERENT', purchase_date: addDays(T, -60) } });
  assert.equal(mismatch.bill_verified, false);
  await rejects(reg({ purchase_date: '2027-01-01' }), 400);
  await rejects(reg({ warranty: {} }), 400);
  await rejects(s.products.registerProduct({ name: 'x' }), 400);
});

test('valid claim: validated automatically, timeline has submitted + validated ticks', async () => {
  const { s, cust, reg } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'screen_repair', description: 'Screen has green vertical lines since yesterday' });
  assert.equal(c.status, 'validated');
  assert.match(c.claim_number, /^WV-20261010-[0-9A-F]{4}$/);
  assert.equal(c.fraud_level, 'low');
  assert.deepEqual(c.timeline.map((e) => [e.status, e.tick]), [['submitted', 'sent'], ['validated', 'delivered']]);
});

test('AI triage fills in service_type when the customer only describes the problem', async () => {
  const { s, cust, reg } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, description: 'The battery drains really fast and charging is slow' });
  assert.equal(c.service_type, 'battery_replacement');
  assert.equal(c.ai_triage.source, 'rules');
});

test('expired warranty: claim is stored as rejected with the reason', async () => {
  const { s, cust, reg } = await setup();
  const p = await reg({ purchase_date: addDays(T, -800) });
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'screen_repair', description: 'Screen is flickering a lot now' });
  assert.equal(c.status, 'rejected');
  assert.match(c.rejection_reason, /expired/i);
  assert.deepEqual(c.timeline.map((e) => e.status), ['submitted', 'rejected']);
  assert.equal(c.timeline[1].tick, 'failed');
  // the dry-run endpoint says the same without writing anything
  const before = (await s.claims.list({ customer_id: cust.id })).length;
  const v = await s.claims.validate({ product_id: p.id, service_type: 'screen_repair' });
  assert.equal(v.eligible, false);
  assert.equal((await s.claims.list({ customer_id: cust.id })).length, before);
});

test('duplicate claim: 409 with the existing claim; different issue still allowed; allowed again after completion', async () => {
  const { s, cust, reg, hub } = await setup();
  const p = await reg();
  const first = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'motor_repair', description: 'Loud grinding noise from the drum' });
  await assert.rejects(
    s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'motor_repair', description: 'Still grinding, please help' }),
    (e) => e.status === 409 && e.code === 'DUPLICATE_CLAIM' && e.details.claim_id === first.id,
  );
  const other = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'software_issue', description: 'Display app keeps crashing on startup' });
  assert.equal(other.status, 'validated');

  const slot = slotsForDate('2026-10-12', 330)[0].start;
  await s.claims.schedule(first.id, { service_center_id: hub.id, scheduled_at: slot });
  await s.claims.changeStatus(first.id, { status: 'in_repair' });
  await s.claims.changeStatus(first.id, { status: 'completed', resolution_notes: 'Bearing replaced' });
  const again = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'motor_repair', description: 'Grinding noise has returned after repair' });
  assert.equal(again.status, 'validated');
  assert.ok(again.eligibility.warnings.some((w) => w.code === 'REPEAT_REPAIR'));
  assert.ok(again.fraud_reasons.some((r) => r.code === 'REPEAT_SAME_ISSUE'));
});

test('not covered (accidental damage on standard plan) and ownership check', async () => {
  const { s, cust, other, reg } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, description: 'I dropped it and the back glass broke' });
  assert.equal(c.service_type, 'accidental_damage');
  assert.equal(c.status, 'rejected');
  await rejects(s.claims.submit({ product_id: p.id, customer_id: other.id, service_type: 'screen_repair', description: 'Not my phone really' }), 403, 'NOT_YOUR_PRODUCT');
});

test('service unavailable at selected center: validate flags it and lists alternatives; schedule refuses', async () => {
  const { s, cust, reg, hub, phoneShop } = await setup();
  const p = await reg();
  const v = await s.claims.validate({ product_id: p.id, service_type: 'cooling_repair', service_center_id: phoneShop.id });
  assert.equal(v.eligible, false);
  assert.deepEqual(v.failed, ['CENTER_SUPPORTS_SERVICE']);
  assert.deepEqual(v.available_centers.map((c) => c.name), ['Hub']);

  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'cooling_repair', description: 'Not cooling properly since last week' });
  const slot = slotsForDate('2026-10-12', 330)[0].start;
  await assert.rejects(
    s.claims.schedule(c.id, { service_center_id: phoneShop.id, scheduled_at: slot }),
    (e) => e.status === 422 && e.code === 'SERVICE_UNAVAILABLE_AT_CENTER' && e.details.alternatives[0].name === 'Hub',
  );
  const ok = await s.claims.schedule(c.id, { service_center_id: hub.id, scheduled_at: slot, technician: 'Ravi' });
  assert.equal(ok.status, 'scheduled');
  assert.equal(ok.service_center.name, 'Hub');
  assert.equal(ok.timeline.at(-1).tick, 'read');
});

test('scheduling: grid, past slots, capacity, reschedule', async () => {
  const { s, cust, reg, phoneShop } = await setup(); // phoneShop has 1 technician
  const mkClaim = async (desc) => {
    const p = await reg();
    return s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'screen_repair', description: desc });
  };
  const [a, b] = [await mkClaim('Screen has dead pixels in the corner'), await mkClaim('Screen is cracked from inside, no drop')];
  const day = slotsForDate('2026-10-12', 330);
  await rejects(s.claims.schedule(a.id, { service_center_id: phoneShop.id, scheduled_at: '2026-10-12T05:00:00.000Z' }), 400); // off-grid
  await rejects(s.claims.schedule(a.id, { service_center_id: phoneShop.id, scheduled_at: slotsForDate('2026-10-09', 330)[0].start }), 400); // past
  await s.claims.schedule(a.id, { service_center_id: phoneShop.id, scheduled_at: day[0].start });
  await rejects(s.claims.schedule(b.id, { service_center_id: phoneShop.id, scheduled_at: day[0].start }), 409, 'SLOT_FULL');
  const slots = await s.centers.slots(phoneShop.id, '2026-10-12');
  assert.equal(slots.slots[0].available, false);
  assert.equal(slots.slots[1].available, true);
  const re = await s.claims.schedule(a.id, { service_center_id: phoneShop.id, scheduled_at: day[1].start }); // reschedule frees slot 0
  assert.equal(re.timeline.at(-1).title, 'Service rescheduled');
  await s.claims.schedule(b.id, { service_center_id: phoneShop.id, scheduled_at: day[0].start });
});

test('status workflow: staff accept/reject/repair/complete; illegal jumps blocked', async () => {
  const { s, cust, reg, hub } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'general_repair', description: 'Device randomly switches off by itself' });
  await rejects(s.claims.changeStatus(c.id, { status: 'completed' }), 409, 'INVALID_TRANSITION');
  await rejects(s.claims.changeStatus(c.id, { status: 'scheduled' }), 400); // must use /schedule
  await s.claims.changeStatus(c.id, { status: 'approved', note: 'Looks fine' });
  await rejects(s.claims.changeStatus(c.id, { status: 'in_repair' }), 409, 'INVALID_TRANSITION'); // not scheduled yet
  await s.claims.schedule(c.id, { service_center_id: hub.id, scheduled_at: slotsForDate('2026-10-11', 330)[2].start });
  await s.claims.changeStatus(c.id, { status: 'in_repair' });
  const done = await s.claims.changeStatus(c.id, { status: 'completed', resolution_notes: 'Replaced mainboard' });
  assert.equal(done.status, 'completed');
  assert.equal(done.resolution_notes, 'Replaced mainboard');
  assert.ok(done.completed_at);
  assert.deepEqual(done.timeline.map((e) => e.status), ['submitted', 'validated', 'approved', 'scheduled', 'in_repair', 'completed']);
  await rejects(s.claims.changeStatus(c.id, { status: 'in_repair' }), 409);

  const p2 = await reg();
  const c2 = await s.claims.submit({ product_id: p2.id, customer_id: cust.id, service_type: 'general_repair', description: 'Strange smell from the charging port' });
  await rejects(s.claims.changeStatus(c2.id, { status: 'rejected' }), 400); // reason required
  const rej = await s.claims.changeStatus(c2.id, { status: 'rejected', rejection_reason: 'Physical liquid damage found' });
  assert.equal(rej.rejection_reason, 'Physical liquid damage found');
});

test('cancel: only the owner, only before repair', async () => {
  const { s, cust, other, reg } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'general_repair', description: 'Speaker crackles at high volume' });
  await rejects(s.claims.cancel(c.id, { customer_id: other.id }), 403, 'NOT_YOUR_CLAIM');
  const x = await s.claims.cancel(c.id, { customer_id: cust.id, note: 'Fixed it myself' });
  assert.equal(x.status, 'cancelled');
  await rejects(s.claims.cancel(c.id, { customer_id: cust.id }), 409, 'INVALID_TRANSITION');
  // cancelled claim no longer blocks a new one for the same issue
  const again = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'general_repair', description: 'Speaker crackles at high volume again' });
  assert.equal(again.status, 'validated');
});

test('fraud flags: no bill + vague text raises score; AI review falls back to rules', async () => {
  const { s, cust, reg } = await setup();
  const p = await reg({ bill_url: null, serial_number: 'AAAAAA' });
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'general_repair', description: 'broken' });
  assert.ok(c.fraud_score >= 60, `score ${c.fraud_score}`);
  assert.equal(c.requires_manual_review, true);
  const flagged = await s.claims.list({ needs_review: 'true' });
  assert.equal(flagged.length, 1);
  const review = await s.claims.aiReview(c.id);
  assert.equal(review.recommendation, 'manual_inspection');
  assert.equal(review.source, 'rules');
});

test('history, list filters, dashboard stats', async () => {
  const { s, cust, reg, hub } = await setup();
  const p = await reg();
  const c = await s.claims.submit({ product_id: p.id, customer_id: cust.id, service_type: 'general_repair', description: 'Device does not charge at all anymore' });
  await s.claims.schedule(c.id, { service_center_id: hub.id, scheduled_at: slotsForDate('2026-10-11', 330)[0].start });
  const h = await s.claims.history(p.id);
  assert.equal(h.claims.length, 1);
  assert.equal(h.claims[0].timeline.length, 3);
  assert.equal((await s.claims.list({ customer_id: cust.id, status: 'scheduled' })).length, 1);
  assert.equal((await s.claims.list({ customer_id: cust.id, status: 'completed' })).length, 0);
  await rejects(s.claims.list({ status: 'bogus' }), 400);
  const st = await s.claims.stats();
  assert.equal(st.total_claims, 1);
  assert.equal(st.by_status.scheduled, 1);
  assert.equal(st.upcoming_appointments[0].service_center.name, 'Hub');
  const prods = await s.products.listProducts(cust.id);
  assert.equal(prods[0].open_claims, 1);
});

test('validation errors are clean 400s / 404s', async () => {
  const { s } = await setup();
  await rejects(s.claims.get('not-a-uuid'), 400);
  await rejects(s.claims.get(crypto.randomUUID()), 404, 'CLAIM_NOT_FOUND');
  await rejects(s.products.getProduct(crypto.randomUUID()), 404, 'PRODUCT_NOT_FOUND');
  await rejects(s.claims.submit({}), 400);
});
