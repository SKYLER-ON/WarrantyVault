# WarrantyVault backend

Digital Warranty & Service Claim Manager (PS-57). Node.js + Express API, Supabase (Postgres + Storage) as the database, Gemini for bill OCR and claim triage.

```
Frontend (React)  ->  Express API (this repo)  ->  Supabase  (data, bill storage)
                                      \-------->  Gemini    (OCR, triage, staff recommendation)
```

The frontend never talks to Supabase or Gemini directly. It only calls this API, so your keys stay on the server.

## Setup (about 5 minutes)

**1. Create the tables.** Supabase dashboard -> *SQL Editor* -> *New query* -> paste all of `supabase/schema.sql` -> *Run*.
It creates 6 tables, the duplicate-claim index, row-level security, and a public `bills` storage bucket.

**2. Get your keys.**
- Supabase: *Project Settings -> API*. Copy the **Project URL** and the **service_role** key (not the anon key).
- Gemini: https://aistudio.google.com/apikey

**3. Configure.**
```bash
cp .env.example .env     # then fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
npm install
```
Needs Node 20.6 or newer. `.env` is gitignored. Never commit the service_role key.

**4. Load demo data.**
```bash
npm run seed
```
It prints a customer id, six products and four service centers with their ids. Keep that output open: you will paste those ids into requests and into the frontend.

**5. Run.**
```bash
npm run dev
curl http://localhost:4000/api/health
```
If your frontend already uses port 4000, change `PORT` in `.env`.

## What the backend does

| Requirement from the problem statement | Where it lives |
|---|---|
| Product and warranty management | `POST/GET /api/products`, `PATCH /api/warranties/:id` |
| Claim eligibility validation | `src/lib/rules.js` `checkEligibility`, dry-run at `POST /api/claims/validate` |
| Service scheduling | `POST /api/claims/:id/schedule`, `GET /api/service-centers/:id/slots` |
| Claim status workflow | `PATCH /api/claims/:id/status`, state machine in `rules.js` |
| Service history | `GET /api/products/:id/history` |
| Edge case: warranty expired | claim is stored as `rejected` with the reason |
| Edge case: duplicate claim | `409 DUPLICATE_CLAIM` (also enforced by a unique index in Postgres) |
| Edge case: service unavailable at center | `CENTER_SUPPORTS_SERVICE` check, `422 SERVICE_UNAVAILABLE_AT_CENTER` with alternative centers |
| Stretch: OCR | `POST /api/ocr/bill` (Gemini vision) |
| Stretch: claim recommendations | `POST /api/claims/:id/ai-review` (Gemini, rule-based fallback) |
| From your slides: fraud risk score | computed on every claim, with the reasons listed |
| From your slides: live ✓✓ tracker | every claim has a `timeline`; each event has a `tick` of `sent`, `delivered`, `read` or `failed` |

### Claim lifecycle

```
submitted -> validated -> approved -> scheduled -> in_repair -> completed
                 |            |            \-> (reschedule)
                 \------------+--> rejected          any open state before repair -> cancelled
```
`submitted -> validated` or `-> rejected` happens automatically inside `POST /api/claims`. A claim that fails eligibility is saved as `rejected` so the customer sees it in their history. The service team can accept, reject or schedule a validated claim; scheduling directly counts as accepting.

### Where Gemini is used (and what happens without it)

| Feature | With `GEMINI_API_KEY` | Without it / on error |
|---|---|---|
| Bill OCR (`/ocr/bill`) | reads product, brand, model, serial, date, price, warranty months | `503`, so the frontend shows a manual form |
| Triage (`/ai/triage`, and `POST /claims` with no `service_type`) | maps the complaint to a service type and severity | keyword rules (`"source": "rules"`) |
| Staff recommendation (`/claims/:id/ai-review`) | approve / reject / manual_inspection plus a customer message | rule-based recommendation |

Gemini never makes the eligibility decision. Dates, coverage, duplicates and center support are plain code, and the AI recommendation cannot override a failed eligibility check.

## API reference

Base URL `http://localhost:4000/api`. JSON in, JSON out. Errors look like `{ "error": { "code", "message", "details" } }`.
Staff endpoints need the header `x-staff-key: <STAFF_KEY from .env>`.

| Method and path | Who | Body / query | Notes |
|---|---|---|---|
| `GET /health` | any | | shows whether Supabase and Gemini are configured |
| `GET /meta` | any | | service types, statuses, transitions, tick mapping (fill dropdowns from this) |
| `POST /customers` | any | `name, email, phone?` | creates or returns the customer by email, so use it as a simple login |
| `GET /customers/:id` | any | | |
| `POST /ocr/bill` | any | multipart field `bill` (jpg, png, webp, pdf, max 8 MB) | returns `extracted`, `bill_url`, `serial_already_registered` |
| `POST /products` | any | `customer_id, name, brand, serial_number, purchase_date, category?, model?, purchase_price?, bill_url?, ocr_data?, warranty: { duration_months \| end_date, start_date?, coverage_type?, covered_services?, terms? }` | `409 DUPLICATE_SERIAL`; `bill_verified` is true when `ocr_data` matches serial and date |
| `GET /products?customer_id=` | any | | each product has `warranty.status` (`active`, `expiring_soon`, `expired`) and `days_left` |
| `GET /products/:id` | any | | |
| `GET /products/:id/history` | any | | all claims for the product, each with its timeline |
| `PATCH /warranties/:id` | staff | `start_date?, end_date?, coverage_type?, covered_services?, terms?` | handy for demos (flip a warranty to expired) |
| `POST /ai/triage` | any | `description, category?, product_name?` | |
| `POST /claims/validate` | any | `product_id, service_type?, description?, service_center_id?` | dry run: returns the full checklist and `available_centers`, writes nothing |
| `POST /claims` | any | `product_id, customer_id, description, service_type?, service_center_id?, evidence_url?` | `409 DUPLICATE_CLAIM` has `details.claim_id` |
| `GET /claims?customer_id=` | any | also `product_id`, `status` | without `customer_id` or `product_id` it is staff-only; add `needs_review=true` for flagged claims |
| `GET /claims/:id` | any | | claim plus `product`, `service_center`, `warranty`, `timeline` |
| `PATCH /claims/:id/status` | staff | `status: approved \| rejected \| in_repair \| completed`, `rejection_reason?`, `resolution_notes?`, `note?` | illegal jumps return `409 INVALID_TRANSITION` |
| `POST /claims/:id/schedule` | staff | `service_center_id, scheduled_at, technician?` | `scheduled_at` must be a `start` from the slots endpoint; calling it again reschedules |
| `POST /claims/:id/cancel` | customer | `customer_id, note?` | only before repair starts |
| `POST /claims/:id/ai-review` | staff | | |
| `GET /service-centers` | any | `service_type?, city?` | |
| `GET /service-centers/:id/slots?date=YYYY-MM-DD` | any | | hourly 10:00-17:00, `remaining` per slot |
| `GET /dashboard/stats` | staff | | counts by status, flagged claims, warranty health, upcoming appointments |

Auth is deliberately simple for a hackathon (customer id plus a staff key). For production you would switch to Supabase Auth and verify the JWT in a middleware.

## 5-minute demo script

Use the ids printed by `npm run seed`. Staff calls need `-H "x-staff-key: staff-demo-key"`.

1. **Valid vs expired warranty.** `GET /products?customer_id=<demo>` shows the Galaxy S24 as `active`, the fridge as `expiring_soon` and the Sony TV as `expired`.
2. **Eligibility check.** `POST /claims/validate` with the TV's `product_id` and `"service_type":"screen_repair"` fails `WARRANTY_ACTIVE`. The same call with the phone passes every check.
3. **Submit a claim.** `POST /claims` for the phone with a good description. It comes back `validated`, with a fraud score and two timeline events. Submit it for the TV and it comes back `rejected`.
4. **Duplicate guard.** Submit `"service_type":"motor_repair"` for the washing machine (it already has an open claim) and you get `409 DUPLICATE_CLAIM`.
5. **Service unavailable.** Validate a `cooling_repair` claim with `service_center_id` set to *Jayanagar Mobile Care* and you get `CENTER_SUPPORTS_SERVICE` failed plus the centers that can do it.
6. **Schedule.** `GET /service-centers/<hub>/slots?date=<tomorrow>`, then `POST /claims/<id>/schedule` with a slot `start`. Book the same slot again at the one-technician center and you get `SLOT_FULL`.
7. **Track.** `PATCH /claims/<id>/status` to `in_repair`, then `completed`. `GET /claims/<id>` shows the ✓ to ✓✓ to blue ✓✓ timeline, and `GET /products/<id>/history` shows the service history.
8. **AI.** Upload a bill photo to `/ocr/bill`. Describe a problem with no `service_type` on `POST /claims`. Call `/claims/<id>/ai-review` as staff.

Example:
```bash
curl -X POST localhost:4000/api/claims/validate -H 'Content-Type: application/json' \
  -d '{"product_id":"<TV_ID>","service_type":"screen_repair"}'
```

## Project layout

```
supabase/schema.sql      tables, indexes, RLS, storage bucket
src/server.js            starts the server
src/app.js               routes, CORS, uploads, staff-key middleware
src/gemini.js            OCR, triage, review (with fallbacks)
src/services/*.js        products, claims, scheduling logic (talks to Supabase)
src/lib/rules.js         eligibility, fraud score, state machine (pure functions)
src/scripts/seed.js      demo data
test/                    node --test, no extra dependencies
```

## Tests

`npm test` runs 27 tests: the rules (expiry boundaries, duplicates, coverage, center support, fraud score, transitions, slot grid) and the full claim workflow against an in-memory fake of the Supabase client. They need no network and no keys.
