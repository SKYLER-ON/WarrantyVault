import crypto from 'node:crypto';
import { HttpError } from '../lib/errors.js';
import { check } from '../lib/db-helpers.js';
import { bad, requireFields, requireUuid } from '../lib/validate.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { isValidSlot } from '../lib/slots.js';
import {
  CLAIM_STATUSES,
  OPEN_STATUSES,
  SERVICE_TYPES,
  STAFF_STATUS_TARGETS,
  TICKS,
  TRANSITIONS,
  canTransition,
  checkEligibility,
  computeFraud,
  warrantyStatus,
} from '../lib/rules.js';

const EVENT_TITLES = {
  approved: 'Claim accepted by service team',
  rejected: 'Claim rejected by service team',
  in_repair: 'Repair in progress',
  completed: 'Repair completed',
  cancelled: 'Claim cancelled',
};

export function createClaimService({ db, ai, config, now }) {
  const today = () => todayInTz(now(), config.tzOffsetMinutes);
  const nowIso = () => now().toISOString();

  // ---- loaders ---------------------------------------------------------------------------
  async function loadBundle(productId) {
    requireUuid(productId, 'product_id');
    const product = check(await db.from('products').select('*').eq('id', productId).maybeSingle());
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const warranty = check(await db.from('warranties').select('*').eq('product_id', productId).maybeSingle());
    return { product, warranty };
  }

  const productClaims = async (productId) =>
    check(await db.from('claims').select('*').eq('product_id', productId).order('created_at', { ascending: false }));

  async function loadCenter(id) {
    requireUuid(id, 'service_center_id');
    const c = check(await db.from('service_centers').select('*').eq('id', id).maybeSingle());
    if (!c) throw new HttpError(404, 'CENTER_NOT_FOUND', 'Service center not found');
    return c;
  }

  async function centersFor(serviceType) {
    const all = check(await db.from('service_centers').select('*').eq('is_active', true).order('name', { ascending: true }));
    return all.filter((c) => c.supported_services.includes(serviceType)).map((c) => ({ id: c.id, name: c.name, city: c.city, address: c.address }));
  }

  async function getRaw(id) {
    requireUuid(id, 'claim id');
    const claim = check(await db.from('claims').select('*').eq('id', id).maybeSingle());
    if (!claim) throw new HttpError(404, 'CLAIM_NOT_FOUND', 'Claim not found');
    return claim;
  }

  const decorateEvents = (events) => events.map((e) => ({ ...e, tick: TICKS[e.status] ?? 'sent' }));

  async function addEvent(claimId, status, title, note, actor, at = nowIso()) {
    return check(await db.from('claim_events').insert({ claim_id: claimId, status, title, note: note ?? null, actor, created_at: at }).select().single());
  }

  function assertTransition(from, to) {
    if (!canTransition(from, to)) {
      throw new HttpError(409, 'INVALID_TRANSITION', `A claim that is "${from}" cannot move to "${to}".`, { from, to, allowed: TRANSITIONS[from] });
    }
  }

  // Attach product + service-center summaries to a list of claims (manual join keeps queries simple).
  async function withContext(claims) {
    if (!claims.length) return [];
    const pids = [...new Set(claims.map((c) => c.product_id))];
    const cids = [...new Set(claims.map((c) => c.service_center_id).filter(Boolean))];
    const products = check(await db.from('products').select('id, name, brand, model, serial_number, category').in('id', pids));
    const centers = cids.length ? check(await db.from('service_centers').select('id, name, city, address, phone').in('id', cids)) : [];
    const pm = new Map(products.map((p) => [p.id, p]));
    const cm = new Map(centers.map((c) => [c.id, c]));
    return claims.map((c) => ({ ...c, product: pm.get(c.product_id) ?? null, service_center: cm.get(c.service_center_id) ?? null, tick: TICKS[c.status] }));
  }

  // ---- eligibility (shared by validate + submit) ----------------------------------------
  function evaluate({ product, warranty, claims, serviceType, center }) {
    const t = today();
    const cutoff = addDays(t, -90);
    const openClaims = claims.filter((c) => OPEN_STATUSES.includes(c.status));
    const recentCompleted = claims.filter(
      (c) => c.status === 'completed' && c.service_type === serviceType && String(c.completed_at ?? c.created_at).slice(0, 10) >= cutoff,
    );
    return checkEligibility({ warranty, serviceType, today: t, openClaims, recentCompleted, center });
  }

  async function resolveServiceType(input, product) {
    if (input.service_type) {
      if (!SERVICE_TYPES[input.service_type]) throw bad(`service_type must be one of: ${Object.keys(SERVICE_TYPES).join(', ')}`);
      return { serviceType: input.service_type, triage: null };
    }
    requireFields(input, ['description']);
    const triage = await ai.triage({ category: product.category, product_name: product.name, description: input.description });
    return { serviceType: triage.service_type, triage };
  }

  // ---- public API ------------------------------------------------------------------------
  /** Dry-run: tells the customer whether a claim would be accepted. Writes nothing. */
  async function validate(input = {}) {
    requireFields(input, ['product_id']);
    const { product, warranty } = await loadBundle(input.product_id);
    const { serviceType, triage } = await resolveServiceType({ ...input, description: input.description ?? '' }, product);
    const center = input.service_center_id ? await loadCenter(input.service_center_id) : null;
    const claims = await productClaims(product.id);
    const eligibility = evaluate({ product, warranty, claims, serviceType, center });
    return {
      product: { id: product.id, name: product.name, brand: product.brand },
      service_type: serviceType,
      ai_triage: triage,
      ...eligibility,
      available_centers: await centersFor(serviceType),
    };
  }

  async function submit(input = {}) {
    requireFields(input, ['product_id', 'customer_id', 'description']);
    requireUuid(input.customer_id, 'customer_id');
    const description = String(input.description).trim();
    if (description.length < 5) throw bad('Please describe the issue (at least 5 characters).');

    const { product, warranty } = await loadBundle(input.product_id);
    if (product.customer_id !== input.customer_id) throw new HttpError(403, 'NOT_YOUR_PRODUCT', 'This product belongs to a different customer.');

    const { serviceType, triage } = await resolveServiceType({ ...input, description }, product);
    const center = input.service_center_id ? await loadCenter(input.service_center_id) : null;
    const claims = await productClaims(product.id);
    const eligibility = evaluate({ product, warranty, claims, serviceType, center });

    // Duplicate guard: never create a second open claim for the same product + issue.
    if (eligibility.failed.includes('NO_DUPLICATE_CLAIM')) {
      throw new HttpError(409, 'DUPLICATE_CLAIM', 'A claim for this product and issue is already open.', {
        claim_id: eligibility.duplicate_claim_id,
        claim_number: eligibility.duplicate_claim_number,
        eligibility,
      });
    }

    const customerClaims = check(await db.from('claims').select('*').eq('customer_id', input.customer_id));
    const fraud = computeFraud({ product, warranty, customerClaims, description, serviceType, today: today() });
    const eligible = eligibility.eligible;
    const rejection_reason = eligible ? null : eligibility.failure_messages.join(' ');

    const claimResult = await db
      .from('claims')
      .insert({
        claim_number: genClaimNumber(now()),
        customer_id: input.customer_id,
        product_id: product.id,
        warranty_id: warranty?.id ?? null,
        service_type: serviceType,
        description,
        status: eligible ? 'validated' : 'rejected',
        eligibility,
        fraud_score: fraud.score,
        fraud_level: fraud.level,
        fraud_reasons: fraud.reasons,
        requires_manual_review: fraud.requires_manual_review,
        ai_triage: triage,
        evidence_url: input.evidence_url ?? null,
        service_center_id: center?.id ?? null,
        rejection_reason,
      })
      .select()
      .single();
    if (claimResult.error?.code === '23505') {
      throw new HttpError(409, 'DUPLICATE_CLAIM', 'A claim for this product and issue is already open.');
    }
    const claim = check(claimResult);

    // Timeline. The two opening events are written together, so give them distinct timestamps
    // (submitted = t0-1ms, validated/rejected = t0) to keep them ordered and before any later event.
    const t0 = now().getTime();
    await addEvent(claim.id, 'submitted', 'Claim submitted', description, 'customer', new Date(t0 - 1).toISOString());
    if (eligible) {
      await addEvent(
        claim.id,
        'validated',
        'Warranty validated',
        `Warranty valid, ${eligibility.days_left} day(s) left. Fraud risk: ${fraud.level} (${fraud.score}/100).${fraud.requires_manual_review ? ' Flagged for manual review.' : ''}`,
        'system',
        new Date(t0).toISOString(),
      );
    } else {
      await addEvent(claim.id, 'rejected', 'Claim rejected automatically', rejection_reason, 'system', new Date(t0).toISOString());
    }
    return get(claim.id);
  }

  async function get(id) {
    const claim = await getRaw(id);
    const [ctx] = await withContext([claim]);
    const warranty = check(await db.from('warranties').select('*').eq('product_id', claim.product_id).maybeSingle());
    const events = check(await db.from('claim_events').select('*').eq('claim_id', id).order('created_at', { ascending: true }));
    return { ...ctx, warranty: warranty ? { ...warranty, ...warrantyStatus(warranty, today()) } : null, timeline: decorateEvents(events) };
  }

  async function list({ customer_id, product_id, status, needs_review } = {}) {
    if (status && !CLAIM_STATUSES.includes(status)) throw bad(`status must be one of: ${CLAIM_STATUSES.join(', ')}`);
    let q = db.from('claims').select('*');
    if (customer_id) q = q.eq('customer_id', requireUuid(customer_id, 'customer_id'));
    if (product_id) q = q.eq('product_id', requireUuid(product_id, 'product_id'));
    if (status) q = q.eq('status', status);
    let rows = check(await q.order('created_at', { ascending: false }));
    if (needs_review === 'true' || needs_review === true) rows = rows.filter((c) => c.requires_manual_review && OPEN_STATUSES.includes(c.status));
    return withContext(rows);
  }

  /** Service team: accept / reject / start repair / complete. */
  async function changeStatus(id, input = {}) {
    const claim = await getRaw(id);
    const to = input.status;
    if (!STAFF_STATUS_TARGETS.includes(to)) {
      throw bad(`status must be one of: ${STAFF_STATUS_TARGETS.join(', ')}. Use /schedule to schedule and /cancel to cancel.`);
    }
    assertTransition(claim.status, to);
    const patch = { status: to };
    if (to === 'rejected') {
      if (!input.rejection_reason || !String(input.rejection_reason).trim()) throw bad('rejection_reason is required when rejecting a claim');
      patch.rejection_reason = String(input.rejection_reason).trim();
    }
    if (to === 'completed') {
      patch.completed_at = nowIso();
      patch.resolution_notes = input.resolution_notes ?? input.note ?? null;
    }
    check(await db.from('claims').update(patch).eq('id', id).select().single());
    await addEvent(id, to, EVENT_TITLES[to], to === 'rejected' ? patch.rejection_reason : (patch.resolution_notes ?? input.note ?? null), 'service_team');
    return get(id);
  }

  /** Service team: book (or re-book) a repair at a center that actually supports the service. */
  async function schedule(id, input = {}) {
    const claim = await getRaw(id);
    if (!['validated', 'approved', 'scheduled'].includes(claim.status)) {
      throw new HttpError(409, 'INVALID_TRANSITION', `A claim that is "${claim.status}" cannot be scheduled.`, { allowed: ['validated', 'approved', 'scheduled'] });
    }
    requireFields(input, ['service_center_id', 'scheduled_at']);
    const center = await loadCenter(input.service_center_id);
    if (!center.is_active) throw new HttpError(422, 'CENTER_INACTIVE', `${center.name} is not accepting bookings.`);

    if (!center.supported_services.includes(claim.service_type)) {
      throw new HttpError(422, 'SERVICE_UNAVAILABLE_AT_CENTER', `${center.name} does not offer "${SERVICE_TYPES[claim.service_type]}".`, {
        service_type: claim.service_type,
        alternatives: await centersFor(claim.service_type),
      });
    }

    const at = new Date(input.scheduled_at);
    if (Number.isNaN(at.getTime())) throw bad('scheduled_at must be an ISO date-time (use a "start" value from /service-centers/:id/slots)');
    const iso = at.toISOString();
    if (!isValidSlot(iso, config.tzOffsetMinutes)) throw bad('scheduled_at is not on the appointment grid. Use a "start" value from /service-centers/:id/slots.');
    if (at.getTime() <= now().getTime()) throw bad('scheduled_at is in the past');

    const sameSlot = check(
      await db.from('claims').select('id').eq('service_center_id', center.id).eq('scheduled_at', iso).in('status', ['scheduled', 'in_repair']),
    ).filter((c) => c.id !== claim.id);
    if (sameSlot.length >= center.technicians) {
      throw new HttpError(409, 'SLOT_FULL', 'That slot is fully booked. Pick another slot.', { booked: sameSlot.length, technicians: center.technicians });
    }

    const rescheduled = claim.status === 'scheduled';
    check(
      await db
        .from('claims')
        .update({ status: 'scheduled', service_center_id: center.id, scheduled_at: iso, technician: input.technician ?? claim.technician ?? null })
        .eq('id', id)
        .select()
        .single(),
    );
    await addEvent(id, 'scheduled', rescheduled ? 'Service rescheduled' : 'Service scheduled', `${center.name}, ${center.city} on ${iso}`, 'service_team');
    return get(id);
  }

  /** Customer withdraws a claim that is not yet in repair. */
  async function cancel(id, input = {}) {
    requireFields(input, ['customer_id']);
    const claim = await getRaw(id);
    if (claim.customer_id !== input.customer_id) throw new HttpError(403, 'NOT_YOUR_CLAIM', 'This claim belongs to a different customer.');
    assertTransition(claim.status, 'cancelled');
    check(await db.from('claims').update({ status: 'cancelled' }).eq('id', id).select().single());
    await addEvent(id, 'cancelled', EVENT_TITLES.cancelled, input.note ?? null, 'customer');
    return get(id);
  }

  /** Stretch goal: AI recommendation for the service team (Gemini, rule-based fallback). */
  async function aiReview(id) {
    const claim = await getRaw(id);
    const { product, warranty } = await loadBundle(claim.product_id);
    const history = (await productClaims(product.id)).filter((c) => c.id !== claim.id).slice(0, 5);
    const review = await ai.review({
      claim: { number: claim.claim_number, service_type: claim.service_type, description: claim.description, status: claim.status },
      product: { name: product.name, brand: product.brand, category: product.category, purchase_date: product.purchase_date, has_bill: Boolean(product.bill_url), bill_verified: product.bill_verified },
      warranty: warranty ? { ...warrantyStatus(warranty, today()), coverage_type: warranty.coverage_type, end_date: warranty.end_date } : null,
      eligibility: { eligible: claim.eligibility?.eligible, failed: claim.eligibility?.failed, failure_messages: claim.eligibility?.failure_messages, warnings: claim.eligibility?.warnings },
      fraud: { score: claim.fraud_score, level: claim.fraud_level, requires_manual_review: claim.requires_manual_review, reasons: claim.fraud_reasons },
      previous_claims_on_product: history.map((c) => ({ service_type: c.service_type, status: c.status })),
    });
    check(await db.from('claims').update({ ai_review: review }).eq('id', id).select().single());
    return review;
  }

  /** Numbers for the service-team dashboard. */
  async function stats() {
    const claims = check(await db.from('claims').select('*'));
    const warranties = check(await db.from('warranties').select('*'));
    const products = check(await db.from('products').select('id'));
    const t = today();
    const by_status = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0]));
    for (const c of claims) by_status[c.status] = (by_status[c.status] || 0) + 1;
    const open = claims.filter((c) => OPEN_STATUSES.includes(c.status));
    const nowMs = now().getTime();
    const upcoming = claims
      .filter((c) => c.status === 'scheduled' && c.scheduled_at && Date.parse(c.scheduled_at) >= nowMs)
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
      .slice(0, 10);
    const statuses = warranties.map((w) => warrantyStatus(w, t).status);
    return {
      total_products: products.length,
      total_claims: claims.length,
      open_claims: open.length,
      by_status,
      auto_rejected: claims.filter((c) => c.status === 'rejected' && c.eligibility?.eligible === false).length,
      flagged_for_review: open.filter((c) => c.requires_manual_review).length,
      avg_fraud_score: claims.length ? Math.round(claims.reduce((s, c) => s + (c.fraud_score || 0), 0) / claims.length) : 0,
      warranties: {
        active: statuses.filter((s) => s === 'active').length,
        expiring_soon: statuses.filter((s) => s === 'expiring_soon').length,
        expired: statuses.filter((s) => s === 'expired').length,
      },
      upcoming_appointments: await withContext(upcoming),
    };
  }

  /** Full repair record for one product: every claim with its timeline. */
  async function history(productId) {
    const { product } = await loadBundle(productId);
    const claims = await productClaims(product.id);
    if (!claims.length) return { product: { id: product.id, name: product.name }, claims: [] };
    const events = check(await db.from('claim_events').select('*').in('claim_id', claims.map((c) => c.id)).order('created_at', { ascending: true }));
    const ctx = await withContext(claims);
    return {
      product: { id: product.id, name: product.name, brand: product.brand, serial_number: product.serial_number },
      claims: ctx.map((c) => ({ ...c, timeline: decorateEvents(events.filter((e) => e.claim_id === c.id)) })),
    };
  }

  return { validate, submit, get, list, changeStatus, schedule, cancel, aiReview, stats, history };
}

function genClaimNumber(d) {
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `WV-${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
