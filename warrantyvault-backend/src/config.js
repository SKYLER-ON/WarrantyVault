const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  staffKey: process.env.STAFF_KEY || '',
  tzOffsetMinutes: num(process.env.SERVICE_TZ_OFFSET_MINUTES, 330),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  billsBucket: 'bills',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
};
