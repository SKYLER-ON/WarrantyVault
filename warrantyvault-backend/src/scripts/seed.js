// Demo data: valid / expiring / expired warranties, centers with different services, a claim history.
// Run:  npm run seed      (wipes existing data first)
import { config } from '../config.js';
import { createDb } from '../db.js';
import { addDays, addMonths, todayInTz } from '../lib/dates.js';
import { COVERAGE_TYPES } from '../lib/rules.js';
import { check } from '../lib/db-helpers.js';

const db = createDb(config);
if (!db.configured) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const T = todayInTz(new Date(), config.tzOffsetMinutes);
const ts = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const BILL = 'https://placehold.co/600x800/png?text=Sample+Bill';
const NIL = '00000000-0000-0000-0000-000000000000';

async function wipe() {
  for (const t of ['claim_events', 'claims', 'warranties', 'products', 'service_centers', 'customers']) {
    check(await db.from(t).delete().neq('id', NIL));
  }
}

async function main() {
  await wipe();

  const [demo, other] = check(
    await db
      .from('customers')
      .insert([
        { name: 'Demo Customer', email: 'demo@warrantyvault.dev', phone: '+91 98765 43210' },
        { name: 'Another Customer', email: 'other@warrantyvault.dev', phone: '+91 91234 56789' },
      ])
      .select(),
  );

  const centers = check(
    await db
      .from('service_centers')
      .insert([
        {
          name: 'Central Service Hub',
          city: 'Bengaluru',
          address: 'MG Road, Bengaluru',
          phone: '080 4000 1000',
          technicians: 2,
          supported_services: ['general_repair', 'screen_repair', 'battery_replacement', 'motor_repair', 'cooling_repair', 'software_issue', 'installation'],
        },
        {
          name: 'Jayanagar Mobile Care',
          city: 'Bengaluru',
          address: '4th Block, Jayanagar',
          phone: '080 4000 2000',
          technicians: 1,
          supported_services: ['general_repair', 'screen_repair', 'battery_replacement', 'software_issue'],
        },
        {
          name: 'Whitefield Appliance Works',
          city: 'Bengaluru',
          address: 'ITPL Main Road, Whitefield',
          phone: '080 4000 3000',
          technicians: 2,
          supported_services: ['general_repair', 'motor_repair', 'cooling_repair', 'installation'],
        },
        {
          name: 'Indiranagar Express Desk',
          city: 'Bengaluru',
          address: '100 Feet Road, Indiranagar',
          phone: '080 4000 4000',
          technicians: 2,
          supported_services: ['general_repair', 'software_issue', 'installation'],
        },
      ])
      .select(),
  );
  const hub = centers[0];

  // [product fields, warranty fields]
  const defs = [
    {
      key: 'phone',
      p: { name: 'Galaxy S24', brand: 'Samsung', category: 'mobile', model: 'SM-S921B', serial_number: 'RZCX20ABC123', purchase_date: addDays(T, -90), purchase_price: 74999, bill_url: BILL, bill_verified: true },
      w: { start_date: addDays(T, -90), end_date: addMonths(addDays(T, -90), 12), coverage_type: 'standard' },
    },
    {
      key: 'fridge',
      p: { name: '260L Double Door Refrigerator', brand: 'LG', category: 'refrigerator', model: 'GL-N292', serial_number: 'LG-REF-558812', purchase_date: addMonths(addDays(T, 12), -12), purchase_price: 28990, bill_url: BILL, bill_verified: true },
      w: { start_date: addMonths(addDays(T, 12), -12), end_date: addDays(T, 12), coverage_type: 'standard' }, // expires in 12 days
    },
    {
      key: 'tv',
      p: { name: 'Bravia 43" 4K TV', brand: 'Sony', category: 'tv', model: 'KD-43X75', serial_number: 'SONY-TV-904417', purchase_date: addDays(T, -800), purchase_price: 45990, bill_url: BILL, bill_verified: true },
      w: { start_date: addDays(T, -800), end_date: addMonths(addDays(T, -800), 12), coverage_type: 'standard' }, // long expired
    },
    {
      key: 'laptop',
      p: { name: 'XPS 13', brand: 'Dell', category: 'laptop', model: '9340', serial_number: 'DLXPS13-77A1B2', purchase_date: addDays(T, -200), purchase_price: 119990, bill_url: BILL, bill_verified: true },
      w: { start_date: addDays(T, -200), end_date: addMonths(addDays(T, -200), 24), coverage_type: 'comprehensive' }, // covers accidental damage
    },
    {
      key: 'washer',
      p: { name: 'Front Load Washing Machine 7kg', brand: 'Whirlpool', category: 'washing_machine', model: 'FreshCare 7', serial_number: 'WPL-WM-310045', purchase_date: addDays(T, -150), purchase_price: 31490, bill_url: BILL, bill_verified: true },
      w: { start_date: addDays(T, -150), end_date: addMonths(addDays(T, -150), 24), coverage_type: 'standard' },
    },
    {
      key: 'speaker',
      p: { name: 'Flip 6 Bluetooth Speaker', brand: 'JBL', category: 'audio', model: 'Flip 6', serial_number: 'JBL-FLIP6-90210', purchase_date: addDays(T, -30), purchase_price: 9999, bill_url: null, bill_verified: false },
      w: { start_date: addDays(T, -30), end_date: addMonths(addDays(T, -30), 12), coverage_type: 'standard' }, // no bill on file -> higher fraud score
    },
  ];

  const P = {};
  for (const d of defs) {
    const product = check(await db.from('products').insert({ customer_id: demo.id, ...d.p }).select().single());
    const warranty = check(
      await db.from('warranties').insert({ product_id: product.id, covered_services: COVERAGE_TYPES[d.w.coverage_type], ...d.w }).select().single(),
    );
    P[d.key] = { product, warranty };
  }

  async function claim(key, fields, events) {
    const c = check(
      await db
        .from('claims')
        .insert({
          customer_id: demo.id,
          product_id: P[key].product.id,
          warranty_id: P[key].warranty.id,
          eligibility: { eligible: true, checks: [], failed: [], failure_messages: [], warnings: [] },
          fraud_score: 0,
          fraud_level: 'low',
          ...fields,
        })
        .select()
        .single(),
    );
    check(await db.from('claim_events').insert(events.map((e) => ({ claim_id: c.id, ...e }))));
    return c;
  }

  // 1) A finished repair on the phone -> service history + "repeat repair" warning for battery claims
  await claim(
    'phone',
    {
      claim_number: `WV-DEMO-0001`,
      service_type: 'battery_replacement',
      description: 'Battery drains from 100% to 20% in about two hours with light use.',
      status: 'completed',
      service_center_id: hub.id,
      scheduled_at: ts(38),
      completed_at: ts(36),
      resolution_notes: 'Battery replaced, 30-minute drain test passed.',
      created_at: ts(42),
    },
    [
      { status: 'submitted', title: 'Claim submitted', note: 'Battery drains very fast', actor: 'customer', created_at: ts(42) },
      { status: 'validated', title: 'Warranty validated', note: 'Warranty valid. Fraud risk: low (0/100).', actor: 'system', created_at: ts(42) },
      { status: 'approved', title: 'Claim accepted by service team', actor: 'service_team', created_at: ts(41) },
      { status: 'scheduled', title: 'Service scheduled', note: `${hub.name}, ${hub.city}`, actor: 'service_team', created_at: ts(40) },
      { status: 'in_repair', title: 'Repair in progress', actor: 'service_team', created_at: ts(38) },
      { status: 'completed', title: 'Repair completed', note: 'Battery replaced, drain test passed.', actor: 'service_team', created_at: ts(36) },
    ],
  );

  // 2) An open claim on the washer -> submitting the same issue again demonstrates the duplicate guard
  await claim(
    'washer',
    {
      claim_number: `WV-DEMO-0002`,
      service_type: 'motor_repair',
      description: 'Drum makes a loud grinding noise during the spin cycle.',
      status: 'validated',
      created_at: ts(1),
    },
    [
      { status: 'submitted', title: 'Claim submitted', note: 'Drum grinds during spin', actor: 'customer', created_at: ts(1) },
      { status: 'validated', title: 'Warranty validated', note: 'Warranty valid. Fraud risk: low (0/100).', actor: 'system', created_at: ts(1) },
    ],
  );

  console.log('\nSeeded.\n');
  console.log('Demo customer id :', demo.id, '(demo@warrantyvault.dev)');
  console.log('Other customer id:', other.id, '(for the "not your product" check)\n');
  console.log('Products (demo customer):');
  console.log(`  ACTIVE     phone   ${P.phone.product.id}   Galaxy S24 - valid; battery claim shows repeat-repair warning`);
  console.log(`  EXPIRING   fridge  ${P.fridge.product.id}   LG fridge - expires in 12 days (${P.fridge.warranty.end_date})`);
  console.log(`  EXPIRED    tv      ${P.tv.product.id}   Sony TV - warranty over (${P.tv.warranty.end_date})`);
  console.log(`  COMPREHENS laptop  ${P.laptop.product.id}   Dell XPS - accidental damage covered`);
  console.log(`  DUPLICATE  washer  ${P.washer.product.id}   Whirlpool - already has an open motor_repair claim`);
  console.log(`  NO BILL    speaker ${P.speaker.product.id}   JBL speaker - no bill on file (higher fraud score)\n`);
  console.log('Service centers:');
  for (const c of centers) console.log(`  ${c.id}  ${c.name}  [${c.supported_services.join(', ')}]`);
  console.log('');
}

main().catch((e) => {
  console.error('Seed failed:', e.message ?? e);
  process.exit(1);
});
