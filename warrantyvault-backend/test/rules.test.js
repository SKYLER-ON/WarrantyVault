import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, daysBetween, isDateStr } from '../src/lib/dates.js';
import { checkEligibility, computeFraud, warrantyStatus, canTransition, COVERAGE_TYPES } from '../src/lib/rules.js';
import { isValidSlot, slotsForDate, localDateOfInstant } from '../src/lib/slots.js';
import { heuristicTriage, normalizeBill } from '../src/gemini.js';

const TODAY = '2026-10-10';
const W = (over = {}) => ({ id: 'w1', start_date: '2026-01-01', end_date: '2027-01-01', coverage_type: 'standard', covered_services: COVERAGE_TYPES.standard, ...over });

test('date helpers', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2025-10-10', 12), '2026-10-10');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addDays('2026-10-10', -10), '2026-09-30');
  assert.equal(daysBetween('2026-10-10', '2026-10-22'), 12);
  assert.ok(isDateStr('2026-02-28') && !isDateStr('2026-02-30') && !isDateStr('26-1-1'));
});

test('warranty status: active / expiring / expiry day / expired', () => {
  assert.equal(warrantyStatus(W(), TODAY).status, 'active');
  assert.equal(warrantyStatus(W({ end_date: '2026-10-22' }), TODAY).status, 'expiring_soon');
  assert.equal(warrantyStatus(W({ end_date: TODAY }), TODAY).status, 'expiring_soon'); // last day still valid
  const exp = warrantyStatus(W({ end_date: '2026-10-09' }), TODAY);
  assert.equal(exp.status, 'expired');
  assert.equal(exp.days_left, -1);
  assert.equal(warrantyStatus(W({ start_date: '2026-11-01' }), TODAY).status, 'not_started');
  assert.equal(warrantyStatus(null, TODAY).status, 'none');
});

test('eligibility: valid claim passes every check', () => {
  const r = checkEligibility({ warranty: W(), serviceType: 'screen_repair', today: TODAY });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.failed, []);
});

test('eligibility: expired warranty is rejected with a clear reason', () => {
  const r = checkEligibility({ warranty: W({ end_date: '2026-09-01' }), serviceType: 'screen_repair', today: TODAY });
  assert.equal(r.eligible, false);
  assert.deepEqual(r.failed, ['WARRANTY_ACTIVE']);
  assert.match(r.failure_messages[0], /expired on 2026-09-01 \(39 day/);
});

test('eligibility: accidental damage not covered on standard, covered on comprehensive', () => {
  assert.deepEqual(checkEligibility({ warranty: W(), serviceType: 'accidental_damage', today: TODAY }).failed, ['SERVICE_COVERED']);
  const comp = W({ coverage_type: 'comprehensive', covered_services: COVERAGE_TYPES.comprehensive });
  assert.equal(checkEligibility({ warranty: comp, serviceType: 'accidental_damage', today: TODAY }).eligible, true);
});

test('eligibility: duplicate open claim for same issue (but a different issue is fine)', () => {
  const open = [{ id: 'c1', claim_number: 'WV-1', status: 'validated', service_type: 'motor_repair' }];
  const dup = checkEligibility({ warranty: W(), serviceType: 'motor_repair', today: TODAY, openClaims: open });
  assert.deepEqual(dup.failed, ['NO_DUPLICATE_CLAIM']);
  assert.equal(dup.duplicate_claim_id, 'c1');
  assert.equal(checkEligibility({ warranty: W(), serviceType: 'software_issue', today: TODAY, openClaims: open }).eligible, true);
});

test('eligibility: selected center must support the service', () => {
  const center = { name: 'Phone Shop', supported_services: ['screen_repair'] };
  assert.deepEqual(checkEligibility({ warranty: W(), serviceType: 'cooling_repair', today: TODAY, center }).failed, ['CENTER_SUPPORTS_SERVICE']);
  assert.equal(checkEligibility({ warranty: W(), serviceType: 'screen_repair', today: TODAY, center }).eligible, true);
});

test('eligibility: no warranty / warnings', () => {
  assert.deepEqual(checkEligibility({ warranty: null, serviceType: 'general_repair', today: TODAY }).failed, ['WARRANTY_EXISTS']);
  const r = checkEligibility({ warranty: W({ end_date: '2026-10-15' }), serviceType: 'general_repair', today: TODAY, recentCompleted: [{ claim_number: 'WV-0' }] });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ['EXPIRING_SOON', 'REPEAT_REPAIR']);
});

test('fraud score: clean claim is low; messy claim is high and flagged', () => {
  const good = { id: 'p1', serial_number: 'RZCX20ABC123', bill_url: 'x', bill_verified: true };
  const low = computeFraud({ product: good, warranty: W(), customerClaims: [], description: 'Battery drains from 100% to 20% in two hours', serviceType: 'battery_replacement', today: TODAY });
  assert.equal(low.score, 0);
  assert.equal(low.level, 'low');

  const bad = { id: 'p2', serial_number: '1111', bill_url: null, bill_verified: false };
  const claims = [1, 2, 3].map((i) => ({ product_id: 'p9', status: 'rejected', created_at: `2026-09-${10 + i}T00:00:00Z`, service_type: 'general_repair' }));
  const high = computeFraud({ product: bad, warranty: W({ end_date: '2026-10-12' }), customerClaims: claims, description: 'broken', serviceType: 'general_repair', today: TODAY });
  assert.equal(high.level, 'high');
  assert.equal(high.requires_manual_review, true);
  assert.ok(high.score <= 100);
  assert.ok(high.reasons.every((r) => r.message && r.points > 0));
});

test('status transitions', () => {
  assert.ok(canTransition('validated', 'scheduled'));
  assert.ok(canTransition('scheduled', 'scheduled')); // reschedule
  assert.ok(!canTransition('validated', 'completed'));
  assert.ok(!canTransition('completed', 'in_repair'));
  assert.ok(!canTransition('rejected', 'approved'));
});

test('slots: hourly grid honours timezone', () => {
  const s = slotsForDate('2026-10-12', 330);
  assert.equal(s.length, 8);
  assert.equal(s[0].start, '2026-10-12T04:30:00.000Z'); // 10:00 IST
  assert.ok(isValidSlot('2026-10-12T04:30:00.000Z', 330));
  assert.ok(!isValidSlot('2026-10-12T05:00:00.000Z', 330)); // 10:30 IST - off grid
  assert.equal(localDateOfInstant('2026-10-11T20:00:00Z', 330), '2026-10-12');
});

test('AI fallbacks: triage keywords and bill normalisation', () => {
  assert.equal(heuristicTriage({ description: 'The fridge is not cooling at all' }).service_type, 'cooling_repair');
  assert.equal(heuristicTriage({ description: 'I dropped my phone and the screen cracked' }).service_type, 'accidental_damage');
  assert.equal(heuristicTriage({ description: 'Screen has green lines' }).service_type, 'screen_repair');
  assert.equal(heuristicTriage({ description: 'phone is smoking while charging' }).severity, 'high');
  const b = normalizeBill({ serial_number: ' ab 12 ', purchase_date: '2026-13-45', purchase_price: '4999', warranty_months: '12', confidence: 4 });
  assert.equal(b.serial_number, 'AB12');
  assert.equal(b.purchase_date, null);
  assert.equal(b.purchase_price, 4999);
  assert.equal(b.warranty_months, 12);
  assert.equal(b.confidence, 1);
});
