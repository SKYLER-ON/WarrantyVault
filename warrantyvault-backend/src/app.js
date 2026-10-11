import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config as defaultConfig } from './config.js';
import { createDb, uploadBill } from './db.js';
import { createAi } from './gemini.js';
import { createServices } from './services/index.js';
import { HttpError, asyncHandler, errorMiddleware } from './lib/errors.js';
import { CLAIM_STATUSES, COVERAGE_TYPES, PRODUCT_CATEGORIES, SERVICE_TYPES, STAFF_STATUS_TARGETS, TICKS, TRANSITIONS } from './lib/rules.js';

const ALLOWED_BILL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function createApp(overrides = {}) {
  const config = overrides.config ?? defaultConfig;
  const db = overrides.db ?? createDb(config);
  const ai = overrides.ai ?? createAi(config);
  const ctx = { db, ai, config, now: overrides.now ?? (() => new Date()) };
  const services = createServices(ctx);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      ALLOWED_BILL_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new HttpError(415, 'UNSUPPORTED_FILE', 'Upload a JPG, PNG, WEBP or PDF bill.')),
  });

  // Staff endpoints need the x-staff-key header (skipped if STAFF_KEY is empty).
  const staffOnly = (req, res, next) => {
    if (!config.staffKey || req.get('x-staff-key') === config.staffKey) return next();
    return next(new HttpError(401, 'STAFF_ONLY', 'Missing or wrong x-staff-key header.'));
  };

  const app = express();
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t}ms)`));
    next();
  });

  const r = express.Router();

  // ---- meta ------------------------------------------------------------------------------
  r.get('/health', (req, res) =>
    res.json({ status: 'ok', supabase_configured: Boolean(db.configured ?? true), gemini_configured: ai.enabled, gemini_model: ai.enabled ? ai.model : null }),
  );

  r.get('/meta', (req, res) =>
    res.json({
      service_types: Object.entries(SERVICE_TYPES).map(([value, label]) => ({ value, label })),
      coverage_types: Object.fromEntries(Object.entries(COVERAGE_TYPES).map(([k, v]) => [k, v])),
      product_categories: PRODUCT_CATEGORIES,
      claim_statuses: CLAIM_STATUSES,
      staff_status_targets: STAFF_STATUS_TARGETS,
      transitions: TRANSITIONS,
      ticks: TICKS,
    }),
  );

  // ---- customers -------------------------------------------------------------------------
  r.post('/customers', asyncHandler(async (req, res) => {
    const c = await services.products.upsertCustomer(req.body);
    res.status(c.created ? 201 : 200).json(c);
  }));
  r.get('/customers/:id', asyncHandler(async (req, res) => res.json(await services.products.getCustomer(req.params.id))));

  // ---- products + warranties -------------------------------------------------------------
  r.post('/products', asyncHandler(async (req, res) => res.status(201).json(await services.products.registerProduct(req.body))));
  r.get('/products', asyncHandler(async (req, res) => res.json(await services.products.listProducts(req.query.customer_id))));
  r.get('/products/:id', asyncHandler(async (req, res) => res.json(await services.products.getProduct(req.params.id))));
  r.get('/products/:id/history', asyncHandler(async (req, res) => res.json(await services.claims.history(req.params.id))));
  r.patch('/warranties/:id', staffOnly, asyncHandler(async (req, res) => res.json(await services.products.updateWarranty(req.params.id, req.body))));

  // ---- AI: bill OCR + triage -------------------------------------------------------------
  r.post('/ocr/bill', upload.single('bill'), asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'VALIDATION_ERROR', 'Attach the bill as multipart/form-data field "bill" (jpg, png, webp or pdf).');
    const extracted = await ai.extractBill(req.file.buffer, req.file.mimetype);
    let bill_url = null;
    let upload_warning = null;
    try {
      bill_url = await uploadBill(db, config.billsBucket, req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (e) {
      upload_warning = `Bill was read but not stored (${e.message}). Did you run supabase/schema.sql (creates the "bills" bucket)?`;
    }
    const existing = extracted.serial_number ? await services.products.findBySerial(extracted.serial_number).catch(() => null) : null;
    res.json({ extracted, bill_url, upload_warning, serial_already_registered: Boolean(existing) });
  }));

  r.post('/ai/triage', asyncHandler(async (req, res) => {
    if (!req.body?.description) throw new HttpError(400, 'VALIDATION_ERROR', 'description is required');
    res.json(await ai.triage(req.body));
  }));

  // ---- claims ----------------------------------------------------------------------------
  r.post('/claims/validate', asyncHandler(async (req, res) => res.json(await services.claims.validate(req.body))));
  r.post('/claims', asyncHandler(async (req, res) => res.status(201).json(await services.claims.submit(req.body))));
  r.get('/claims', asyncHandler(async (req, res) => {
    // Without customer_id this lists everyone's claims, so that case is staff-only.
    if (!req.query.customer_id && !req.query.product_id) {
      await new Promise((resolve, reject) => staffOnly(req, res, (e) => (e ? reject(e) : resolve())));
    }
    res.json(await services.claims.list(req.query));
  }));
  r.get('/claims/:id', asyncHandler(async (req, res) => res.json(await services.claims.get(req.params.id))));
  r.patch('/claims/:id/status', staffOnly, asyncHandler(async (req, res) => res.json(await services.claims.changeStatus(req.params.id, req.body))));
  r.post('/claims/:id/schedule', staffOnly, asyncHandler(async (req, res) => res.json(await services.claims.schedule(req.params.id, req.body))));
  r.post('/claims/:id/cancel', asyncHandler(async (req, res) => res.json(await services.claims.cancel(req.params.id, req.body))));
  r.post('/claims/:id/ai-review', staffOnly, asyncHandler(async (req, res) => res.json(await services.claims.aiReview(req.params.id))));

  // ---- service centers + dashboard -------------------------------------------------------
  r.get('/service-centers', asyncHandler(async (req, res) => res.json(await services.centers.list(req.query))));
  r.get('/service-centers/:id/slots', asyncHandler(async (req, res) => res.json(await services.centers.slots(req.params.id, req.query.date))));
  r.get('/dashboard/stats', staffOnly, asyncHandler(async (req, res) => res.json(await services.claims.stats())));

  app.use('/api', r);
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } }));
  app.use(errorMiddleware);
  return app;
}
