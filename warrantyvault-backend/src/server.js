import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`\nWarrantyVault API running on http://localhost:${config.port}/api`);
  console.log(`  Supabase : ${config.supabaseUrl && config.supabaseKey ? 'configured' : 'NOT configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)'}`);
  console.log(`  Gemini   : ${config.geminiKey ? `configured (${config.geminiModel})` : 'NOT configured (OCR disabled, triage uses keyword rules)'}`);
  console.log(`  Staff key: ${config.staffKey ? 'required on staff endpoints (x-staff-key header)' : 'disabled'}\n`);
});
