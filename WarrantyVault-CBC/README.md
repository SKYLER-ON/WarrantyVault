# WarrantyVault

React + Vite frontend for warranty registration, service claims and repair scheduling. It talks to the
`warrantyvault-backend` API (Express + Supabase + Gemini). All data lives in the backend database.

## Run locally

Start the backend first (see its README), then:

```sh
cp .env.example .env     # optional: only needed if the API isn't at http://localhost:4000/api
npm install
npm run dev
```

`VITE_API_BASE_URL` is the only environment variable. Anything prefixed `VITE_` is shipped to the browser, so never put
the Supabase keys, the Gemini key or the staff key in it. Those stay in the backend's `.env`.

## Signing in

- **Customer:** `demo@warrantyvault.dev` / `Demo@123` (use **Auto-fill**). The browser checks this demo password; the server then
  creates or fetches the customer by email. That email is the customer created by the backend's seed script.
- **Service team:** email `adjuster@warrantyvault.internal` and code `123456` (use **Auto-fill demo**) are a browser-side demo gate.
  The **password is the backend's `STAFF_KEY`**, which the server checks. It is kept for the browser session only and sent as the
  `x-staff-key` header. It is never bundled with the app.

This is not production authentication: customers are identified by email only, and the demo email/code/password gates run in the browser.

## What talks to the backend

| Screen | Endpoints |
| --- | --- |
| Sign in (customer) | `POST /customers` |
| Products, registration | `GET /products?customer_id`, `POST /products` |
| Bill upload (optional) | `POST /ocr/bill` (Gemini reads the bill; fields are prefilled, never auto-saved) |
| Claims (customer + staff) | `GET /claims`, `GET /claims/:id`, `POST /claims` |
| Staff status changes | `PATCH /claims/:id/status` |
| Scheduling | `GET /service-centers`, `GET /service-centers/:id/slots`, `POST /claims/:id/schedule` |
| Staff sign-in check | `GET /dashboard/stats` |
| Claim form options | `GET /meta` |

## Known gaps (the backend has no endpoint for these)

- Editing a registered product (the form opens, but saving shows an error).
- Team members page: still static display data.
- Free-text product notes are stored as the warranty terms. Repair notes on the schedule form were removed because the schedule endpoint doesn't store them.
- Not surfaced in the UI yet: claim cancellation, staff AI review, the warranty update endpoint.

## Scripts

- `npm run dev` — start Vite
- `npm run lint` — run Oxlint
- `npm run build` — create a production build
- `npm run preview` — preview the production build
