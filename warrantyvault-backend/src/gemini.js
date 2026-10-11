// Gemini integration: bill OCR, issue triage, and a staff-facing claim recommendation.
// - The SDK is imported lazily, so the server (and the tests) run fine without a key.
// - Triage and review fall back to deterministic rules if Gemini is unavailable, so the demo never dies.
import { HttpError } from './lib/errors.js';
import { isDateStr } from './lib/dates.js';
import { SERVICE_TYPES } from './lib/rules.js';

const TIMEOUT_MS = 30_000;

function stripJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Gemini returned non-JSON output');
  }
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini request timed out')), ms))]);

const str = (v) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);
const numOrNull = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizeBill(raw = {}) {
  const months = numOrNull(raw.warranty_months);
  const conf = numOrNull(raw.confidence);
  return {
    product_name: str(raw.product_name),
    brand: str(raw.brand),
    model: str(raw.model),
    serial_number: str(raw.serial_number)?.toUpperCase().replace(/\s+/g, '') ?? null,
    purchase_date: isDateStr(raw.purchase_date) ? raw.purchase_date : null,
    purchase_price: numOrNull(raw.purchase_price),
    currency: str(raw.currency),
    retailer: str(raw.retailer),
    invoice_number: str(raw.invoice_number),
    warranty_months: months && months > 0 && months <= 120 ? Math.round(months) : null,
    confidence: conf === null ? null : Math.max(0, Math.min(1, conf)),
    notes: str(raw.notes),
  };
}

// ---- Rule-based fallbacks ----------------------------------------------------------------
const KEYWORDS = [
  ['accidental_damage', /\b(drop|dropped|fell|fallen|spill|spilled|liquid|water damage|dunked)\b/i],
  ['screen_repair', /screen|display|crack|touch|pixel|lcd|panel|flicker|lines on/i],
  ['battery_replacement', /batter|charg|drain|swollen|power bank/i],
  ['cooling_repair', /cooling|compressor|not cooling|freezer|fridge|refrigerat|\bac\b|air.?condition|gas leak|ice/i],
  ['motor_repair', /motor|spin|drum|fan\b|noise|vibrat|grind|rattl|agitator/i],
  ['software_issue', /software|firmware|boot|update|hang|hangs|crash|restart|lag|app\b|os\b|stuck on logo/i],
  ['installation', /install|set.?up|demo|mount|first use/i],
];

export function heuristicTriage({ description = '' }) {
  const hit = KEYWORDS.find(([, re]) => re.test(description));
  const service_type = hit ? hit[0] : 'general_repair';
  const severity = /smok(e|ing)|burn|spark|fire|shock|swollen|explod|overheat/i.test(description) ? 'high' : /not (working|turning|powering)|dead|stopped/i.test(description) ? 'medium' : 'low';
  return {
    service_type,
    severity,
    summary: `Looks like: ${SERVICE_TYPES[service_type]}.`,
    likely_covered_by_standard_warranty: service_type !== 'accidental_damage',
    source: 'rules',
  };
}

export function heuristicReview({ eligibility, fraud }) {
  let recommendation = 'approve';
  const key_points = [];
  if (!eligibility?.eligible) {
    recommendation = 'reject';
    key_points.push(...(eligibility?.failure_messages || ['Claim failed eligibility checks.']));
  } else if (fraud?.requires_manual_review) {
    recommendation = 'manual_inspection';
    key_points.push(...(fraud.reasons || []).map((r) => r.message));
  } else if (fraud?.level === 'medium') {
    recommendation = 'manual_inspection';
    key_points.push('Medium fraud risk: verify purchase proof before approving.');
  } else {
    key_points.push('Warranty valid, no duplicate, low fraud risk.');
  }
  return {
    recommendation,
    confidence: 0.6,
    summary: recommendation === 'approve' ? 'Eligible and low risk: approve and schedule.' : recommendation === 'reject' ? 'Not eligible: reject.' : 'Eligible but risky: inspect before approving.',
    key_points,
    customer_message: null,
    source: 'rules',
  };
}

// ---- Factory -----------------------------------------------------------------------------
export function createAi({ geminiKey, geminiModel }) {
  const enabled = Boolean(geminiKey);
  let clientPromise;

  async function client() {
    clientPromise ??= import('@google/genai').then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey: geminiKey }));
    return clientPromise;
  }

  async function generateJson({ system, parts }) {
    const ai = await client();
    const response = await withTimeout(
      ai.models.generateContent({
        model: geminiModel,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction: system, responseMimeType: 'application/json', temperature: 0.1 },
      }),
      TIMEOUT_MS,
    );
    return stripJson(response.text);
  }

  return {
    enabled,
    model: geminiModel,

    /** Read a purchase bill (image or PDF). No fallback: if it fails, the user types the details. */
    async extractBill(buffer, mimeType) {
      if (!enabled) {
        throw new HttpError(503, 'AI_UNAVAILABLE', 'GEMINI_API_KEY is not set. Enter the product details manually.');
      }
      try {
        const raw = await generateJson({
          system:
            'You read purchase invoices/bills for consumer electronics and appliances. Return JSON only. Use null for anything not clearly printed on the document. Never guess or invent values.',
          parts: [
            { inlineData: { mimeType, data: buffer.toString('base64') } },
            {
              text:
                'Extract these fields as JSON: {"product_name": string, "brand": string, "model": string, "serial_number": string, ' +
                '"purchase_date": "YYYY-MM-DD", "purchase_price": number (total for this product, no currency symbol), "currency": string, ' +
                '"retailer": string, "invoice_number": string, "warranty_months": number (only if the bill states a warranty period), ' +
                '"confidence": number between 0 and 1 for how legible/certain the extraction is, "notes": string (anything unclear)}. ' +
                'If several products are listed, pick the main/most expensive one.',
            },
          ],
        });
        return normalizeBill(raw);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, 'AI_FAILED', `Could not read the bill (${e.message}). Enter the details manually.`);
      }
    },

    /** Map a free-text complaint to one of our service types. Falls back to keyword rules. */
    async triage({ category, product_name, description }) {
      const fallback = heuristicTriage({ description });
      if (!enabled) return fallback;
      try {
        const raw = await generateJson({
          system: 'You are a triage assistant at an electronics/appliance warranty desk. Return JSON only.',
          parts: [
            {
              text:
                `Product: ${product_name || 'unknown'} (category: ${category || 'unknown'})\nCustomer complaint: """${description}"""\n\n` +
                `Pick exactly one service_type from: ${Object.keys(SERVICE_TYPES).join(', ')}.\n` +
                'Use accidental_damage only when the customer says it was dropped, spilled on, or physically damaged by them.\n' +
                'Return {"service_type": string, "severity": "low"|"medium"|"high", "summary": string (one short sentence), "likely_covered_by_standard_warranty": boolean}.',
            },
          ],
        });
        if (!SERVICE_TYPES[raw.service_type]) return fallback;
        return {
          service_type: raw.service_type,
          severity: ['low', 'medium', 'high'].includes(raw.severity) ? raw.severity : 'medium',
          summary: str(raw.summary) ?? fallback.summary,
          likely_covered_by_standard_warranty: Boolean(raw.likely_covered_by_standard_warranty),
          source: 'gemini',
        };
      } catch (e) {
        console.warn('[gemini] triage failed, using rules:', e.message);
        return fallback;
      }
    },

    /** Staff-facing recommendation (stretch goal: "claim recommendations"). */
    async review(context) {
      const fallback = heuristicReview(context);
      if (!enabled) return fallback;
      try {
        const raw = await generateJson({
          system:
            'You help a warranty service team decide on claims. You only see structured facts; do not invent any. Return JSON only.',
          parts: [
            {
              text:
                `Claim facts (JSON):\n${JSON.stringify(context)}\n\n` +
                'Return {"recommendation": "approve"|"reject"|"manual_inspection", "confidence": number 0-1, "summary": string (max 2 sentences), ' +
                '"key_points": string[] (max 4), "customer_message": string (a short, polite status note for the customer)}.\n' +
                'Rules: if eligibility.eligible is false, recommend reject. If fraud.requires_manual_review is true, recommend manual_inspection.',
            },
          ],
        });
        const rec = ['approve', 'reject', 'manual_inspection'].includes(raw.recommendation) ? raw.recommendation : fallback.recommendation;
        // Guardrail: the model can never override a failed eligibility check.
        const safeRec = context.eligibility?.eligible === false ? 'reject' : rec;
        return {
          recommendation: safeRec,
          confidence: numOrNull(raw.confidence) ?? 0.7,
          summary: str(raw.summary) ?? fallback.summary,
          key_points: Array.isArray(raw.key_points) ? raw.key_points.map(String).slice(0, 4) : fallback.key_points,
          customer_message: str(raw.customer_message),
          source: 'gemini',
        };
      } catch (e) {
        console.warn('[gemini] review failed, using rules:', e.message);
        return fallback;
      }
    },
  };
}
