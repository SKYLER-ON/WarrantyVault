// Pure business rules: no database, no network. Everything here is unit-tested.
import { addDays, daysBetween } from './dates.js';

export const SERVICE_TYPES = {
  general_repair: 'General repair',
  screen_repair: 'Screen / display repair',
  battery_replacement: 'Battery replacement',
  motor_repair: 'Motor repair',
  cooling_repair: 'Cooling / compressor repair',
  software_issue: 'Software / firmware issue',
  installation: 'Installation / demo',
  accidental_damage: 'Accidental damage',
};

// What each coverage plan pays for. Standard/extended exclude accidental damage.
const ALL = Object.keys(SERVICE_TYPES);
export const COVERAGE_TYPES = {
  standard: ALL.filter((s) => s !== 'accidental_damage'),
  extended: ALL.filter((s) => s !== 'accidental_damage'),
  comprehensive: ALL,
};

export const PRODUCT_CATEGORIES = ['mobile', 'laptop', 'tv', 'refrigerator', 'washing_machine', 'air_conditioner', 'audio', 'kitchen_appliance', 'other'];

// ---- Claim workflow ----------------------------------------------------------------------
export const CLAIM_STATUSES = ['submitted', 'validated', 'approved', 'scheduled', 'in_repair', 'completed', 'rejected', 'cancelled'];
export const OPEN_STATUSES = ['submitted', 'validated', 'approved', 'scheduled', 'in_repair'];

export const TRANSITIONS = {
  submitted: ['validated', 'rejected'],
  validated: ['approved', 'scheduled', 'rejected', 'cancelled'],
  approved: ['scheduled', 'rejected', 'cancelled'],
  scheduled: ['scheduled', 'in_repair', 'cancelled'], // scheduled -> scheduled = reschedule
  in_repair: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

// Statuses a service-team member may set through PATCH /claims/:id/status.
// (scheduling has its own endpoint because it needs a center + slot; cancel is customer-driven.)
export const STAFF_STATUS_TARGETS = ['approved', 'rejected', 'in_repair', 'completed'];

// WhatsApp-style ticks for the live tracker.
export const TICKS = {
  submitted: 'sent', // ✓
  validated: 'delivered', // ✓✓
  approved: 'delivered',
  scheduled: 'read', // ✓✓ blue
  in_repair: 'read',
  completed: 'read',
  rejected: 'failed',
  cancelled: 'failed',
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// ---- Warranty status ---------------------------------------------------------------------
/** days_left is negative once expired (= days since expiry). The expiry date itself is still valid. */
export function warrantyStatus(warranty, today) {
  if (!warranty) return { status: 'none', days_left: null };
  const left = daysBetween(today, warranty.end_date);
  if (today < warranty.start_date) return { status: 'not_started', days_left: left };
  if (left < 0) return { status: 'expired', days_left: left };
  return { status: left <= 30 ? 'expiring_soon' : 'active', days_left: left };
}

// ---- Eligibility -------------------------------------------------------------------------
/**
 * Runs every rule (no short-circuit, so the UI can show a full checklist).
 * @param {object} p
 * @param {object|null} p.warranty
 * @param {string} p.serviceType
 * @param {string} p.today YYYY-MM-DD
 * @param {object[]} p.openClaims open claims for the same product
 * @param {object[]} p.recentCompleted completed claims, same product + service, last 90 days
 * @param {object|null} p.center selected service center (optional)
 */
export function checkEligibility({ warranty, serviceType, today, openClaims = [], recentCompleted = [], center = null }) {
  const checks = [];
  const add = (code, passed, message) => checks.push({ code, passed, message });
  const warnings = [];

  if (!warranty) {
    add('WARRANTY_EXISTS', false, 'No warranty is registered for this product.');
    return finish(checks, warnings, { warranty_status: 'none', days_left: null, duplicate_claim: null });
  }
  add('WARRANTY_EXISTS', true, 'Warranty record found.');

  const ws = warrantyStatus(warranty, today);
  if (ws.status === 'not_started') {
    add('WARRANTY_ACTIVE', false, `Warranty has not started yet (starts ${warranty.start_date}).`);
  } else if (ws.status === 'expired') {
    add('WARRANTY_ACTIVE', false, `Warranty expired on ${warranty.end_date} (${-ws.days_left} day(s) ago).`);
  } else {
    add('WARRANTY_ACTIVE', true, `Warranty valid until ${warranty.end_date} (${ws.days_left} day(s) left).`);
  }

  const covered = (warranty.covered_services || []).includes(serviceType);
  add(
    'SERVICE_COVERED',
    covered,
    covered
      ? `"${SERVICE_TYPES[serviceType] ?? serviceType}" is covered under the ${warranty.coverage_type} plan.`
      : `"${SERVICE_TYPES[serviceType] ?? serviceType}" is not covered under the ${warranty.coverage_type} plan.`,
  );

  const dup = openClaims.find((c) => c.service_type === serviceType) || null;
  add(
    'NO_DUPLICATE_CLAIM',
    !dup,
    dup
      ? `An open claim (${dup.claim_number}, status: ${dup.status}) already exists for this product and issue.`
      : 'No open claim exists for the same product and issue.',
  );

  if (center) {
    const supported = (center.supported_services || []).includes(serviceType);
    add(
      'CENTER_SUPPORTS_SERVICE',
      supported,
      supported
        ? `${center.name} offers "${SERVICE_TYPES[serviceType] ?? serviceType}".`
        : `${center.name} does not offer "${SERVICE_TYPES[serviceType] ?? serviceType}". Choose another center.`,
    );
  }

  if (recentCompleted.length) {
    warnings.push({
      code: 'REPEAT_REPAIR',
      message: `The same issue was already repaired in the last 90 days (${recentCompleted[0].claim_number}). The claim may need inspection.`,
    });
  }
  if (ws.status === 'expiring_soon') {
    warnings.push({ code: 'EXPIRING_SOON', message: `Warranty expires in ${ws.days_left} day(s).` });
  }

  return finish(checks, warnings, { warranty_status: ws.status, days_left: ws.days_left, duplicate_claim: dup });
}

function finish(checks, warnings, extra) {
  return {
    eligible: checks.every((c) => c.passed),
    checks,
    failed: checks.filter((c) => !c.passed).map((c) => c.code),
    failure_messages: checks.filter((c) => !c.passed).map((c) => c.message),
    warnings,
    warranty_status: extra.warranty_status,
    days_left: extra.days_left,
    duplicate_claim_id: extra.duplicate_claim?.id ?? null,
    duplicate_claim_number: extra.duplicate_claim?.claim_number ?? null,
  };
}

// ---- Fraud risk score --------------------------------------------------------------------
const SUSPICIOUS_SERIAL = /^(.)\1+$|^(1234|0000|test|abc|xxx|na$|n\/a)/i;

/**
 * Transparent rule-based score, 0-100. Every point is explained so a judge (or a service agent)
 * can see why a claim was flagged.
 * @param {object} p
 * @param {object} p.product
 * @param {object|null} p.warranty
 * @param {object[]} p.customerClaims all earlier claims by this customer
 * @param {string} p.description
 * @param {string} p.serviceType
 * @param {string} p.today YYYY-MM-DD
 */
export function computeFraud({ product, warranty, customerClaims = [], description = '', serviceType, today }) {
  const reasons = [];
  const add = (code, points, message) => reasons.push({ code, points, message });
  const cutoff = addDays(today, -90);
  const recent = customerClaims.filter((c) => String(c.created_at).slice(0, 10) >= cutoff);

  if (recent.length >= 3) add('MANY_RECENT_CLAIMS', 25, `${recent.length} claims filed by this customer in the last 90 days.`);
  else if (recent.length === 2) add('SEVERAL_RECENT_CLAIMS', 10, '2 claims filed by this customer in the last 90 days.');

  const rejected = customerClaims.filter((c) => c.status === 'rejected').length;
  if (rejected) add('PREVIOUS_REJECTIONS', Math.min(30, rejected * 15), `${rejected} earlier claim(s) from this customer were rejected.`);

  const repeat = customerClaims.filter(
    (c) => c.product_id === product.id && c.service_type === serviceType && c.status === 'completed' && String(c.created_at).slice(0, 10) >= cutoff,
  );
  if (repeat.length) add('REPEAT_SAME_ISSUE', 20, 'Same product and issue was already repaired in the last 90 days.');

  if (warranty && daysBetween(today, warranty.end_date) >= 0 && daysBetween(today, warranty.end_date) <= 7) {
    add('LAST_MINUTE_CLAIM', 10, 'Claim filed within 7 days of warranty expiry.');
  }

  if (String(description).trim().length < 20) add('VAGUE_DESCRIPTION', 15, 'Issue description is very short.');

  if (!product.bill_url) add('NO_PURCHASE_PROOF', 20, 'No purchase bill is attached to this product.');
  else if (!product.bill_verified) add('BILL_NOT_VERIFIED', 10, 'Purchase bill was not cross-checked against the registered details.');

  const serial = String(product.serial_number || '');
  if (serial.length < 5 || SUSPICIOUS_SERIAL.test(serial)) add('SUSPICIOUS_SERIAL', 25, 'Serial number looks invalid or placeholder-like.');

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, level, reasons, requires_manual_review: score >= 60 };
}
