import { HttpError } from '../lib/errors.js';
import { check } from '../lib/db-helpers.js';
import { bad, clean, normalizeSerial, requireFields, requireUuid } from '../lib/validate.js';
import { addMonths, isDateStr, todayInTz } from '../lib/dates.js';
import { COVERAGE_TYPES, PRODUCT_CATEGORIES, SERVICE_TYPES, warrantyStatus } from '../lib/rules.js';

export function createProductService({ db, config, now }) {
  const today = () => todayInTz(now(), config.tzOffsetMinutes);
  const decorate = (product, warranty) => ({ ...product, warranty: warranty ? { ...warranty, ...warrantyStatus(warranty, today()) } : null });

  // ---- customers (email = lightweight login for the demo) ------------------------------
  async function upsertCustomer(input = {}) {
    requireFields(input, ['name', 'email']);
    const email = String(input.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('email is not valid');
    const existing = check(await db.from('customers').select('*').eq('email', email).maybeSingle());
    if (existing) return { ...existing, created: false };
    const row = check(await db.from('customers').insert({ name: String(input.name).trim(), email, phone: clean(input.phone) }).select().single());
    return { ...row, created: true };
  }

  async function getCustomer(id) {
    requireUuid(id, 'customer id');
    const row = check(await db.from('customers').select('*').eq('id', id).maybeSingle());
    if (!row) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    return row;
  }

  // ---- products + warranty ---------------------------------------------------------------
  async function findBySerial(serial) {
    const key = normalizeSerial(serial);
    if (!key) return null;
    return check(await db.from('products').select('id, name, customer_id').eq('serial_number', key).maybeSingle());
  }

  async function registerProduct(input = {}) {
    requireFields(input, ['customer_id', 'name', 'brand', 'serial_number', 'purchase_date']);
    requireUuid(input.customer_id, 'customer_id');
    if (!isDateStr(input.purchase_date)) throw bad('purchase_date must be YYYY-MM-DD');
    if (input.purchase_date > today()) throw bad('purchase_date cannot be in the future');
    await getCustomer(input.customer_id);

    const serial = normalizeSerial(input.serial_number);
    const dupe = await findBySerial(serial);
    if (dupe) {
      throw new HttpError(409, 'DUPLICATE_SERIAL', 'A product with this serial number is already registered.', { product_id: dupe.id });
    }

    const category = PRODUCT_CATEGORIES.includes(input.category) ? input.category : 'other';

    // Warranty: either duration_months (from start_date or purchase_date) or an explicit end_date.
    const w = input.warranty || {};
    const start = w.start_date || input.purchase_date;
    if (!isDateStr(start)) throw bad('warranty.start_date must be YYYY-MM-DD');
    let end = w.end_date;
    if (end) {
      if (!isDateStr(end)) throw bad('warranty.end_date must be YYYY-MM-DD');
    } else {
      const months = Number(w.duration_months);
      if (!Number.isInteger(months) || months < 1 || months > 120) throw bad('warranty.duration_months (1-120) or warranty.end_date is required');
      end = addMonths(start, months);
    }
    if (end <= start) throw bad('warranty end date must be after the start date');

    const coverage_type = w.coverage_type && COVERAGE_TYPES[w.coverage_type] ? w.coverage_type : 'standard';
    let covered = w.covered_services ?? COVERAGE_TYPES[coverage_type];
    if (!Array.isArray(covered) || covered.some((s) => !SERVICE_TYPES[s])) {
      throw bad(`warranty.covered_services must be a subset of: ${Object.keys(SERVICE_TYPES).join(', ')}`);
    }

    // OCR cross-check: if the details came from a scanned bill, verify the key fields still match.
    const ocr = input.ocr_data;
    const bill_verified = Boolean(
      input.bill_url && ocr && ocr.serial_number && normalizeSerial(ocr.serial_number) === serial && ocr.purchase_date === input.purchase_date,
    );

    const product = check(
      await db
        .from('products')
        .insert({
          customer_id: input.customer_id,
          name: String(input.name).trim(),
          brand: String(input.brand).trim(),
          category,
          model: clean(input.model),
          serial_number: serial,
          purchase_date: input.purchase_date,
          purchase_price: input.purchase_price != null && Number.isFinite(Number(input.purchase_price)) ? Number(input.purchase_price) : null,
          bill_url: clean(input.bill_url),
          bill_verified,
        })
        .select()
        .single(),
    );

    let warranty;
    try {
      warranty = check(
        await db
          .from('warranties')
          .insert({ product_id: product.id, start_date: start, end_date: end, coverage_type, covered_services: covered, terms: clean(w.terms) })
          .select()
          .single(),
      );
    } catch (e) {
      await db.from('products').delete().eq('id', product.id); // manual rollback
      throw e;
    }
    return decorate(product, warranty);
  }

  async function listProducts(customerId) {
    requireUuid(customerId, 'customer_id');
    const products = check(await db.from('products').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }));
    if (!products.length) return [];
    const warranties = check(await db.from('warranties').select('*').in('product_id', products.map((p) => p.id)));
    const byProduct = new Map(warranties.map((w) => [w.product_id, w]));
    const open = check(
      await db.from('claims').select('product_id, status').in('product_id', products.map((p) => p.id)).in('status', ['submitted', 'validated', 'approved', 'scheduled', 'in_repair']),
    );
    return products.map((p) => ({ ...decorate(p, byProduct.get(p.id)), open_claims: open.filter((c) => c.product_id === p.id).length }));
  }

  async function getProduct(id) {
    requireUuid(id, 'product id');
    const product = check(await db.from('products').select('*').eq('id', id).maybeSingle());
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const warranty = check(await db.from('warranties').select('*').eq('product_id', id).maybeSingle());
    return decorate(product, warranty);
  }

  /** Edit a warranty (e.g. extend it, change coverage). Staff-only at the route level. */
  async function updateWarranty(id, patch = {}) {
    requireUuid(id, 'warranty id');
    const current = check(await db.from('warranties').select('*').eq('id', id).maybeSingle());
    if (!current) throw new HttpError(404, 'WARRANTY_NOT_FOUND', 'Warranty not found');
    const next = {};
    for (const k of ['start_date', 'end_date']) {
      if (patch[k] !== undefined) {
        if (!isDateStr(patch[k])) throw bad(`${k} must be YYYY-MM-DD`);
        next[k] = patch[k];
      }
    }
    if (patch.coverage_type !== undefined) {
      if (!COVERAGE_TYPES[patch.coverage_type]) throw bad(`coverage_type must be one of: ${Object.keys(COVERAGE_TYPES).join(', ')}`);
      next.coverage_type = patch.coverage_type;
      if (patch.covered_services === undefined) next.covered_services = COVERAGE_TYPES[patch.coverage_type];
    }
    if (patch.covered_services !== undefined) {
      if (!Array.isArray(patch.covered_services) || patch.covered_services.some((s) => !SERVICE_TYPES[s])) throw bad('covered_services contains an unknown service');
      next.covered_services = patch.covered_services;
    }
    if (patch.terms !== undefined) next.terms = clean(patch.terms);
    if ((next.end_date ?? current.end_date) <= (next.start_date ?? current.start_date)) throw bad('end_date must be after start_date');
    const warranty = check(await db.from('warranties').update(next).eq('id', id).select().single());
    return { ...warranty, ...warrantyStatus(warranty, today()) };
  }

  return { upsertCustomer, getCustomer, findBySerial, registerProduct, listProducts, getProduct, updateWarranty };
}
