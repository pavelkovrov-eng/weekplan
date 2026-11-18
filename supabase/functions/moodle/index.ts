// WeekPlan Edge Function "moodle" (2026-11-18): returns the signed-in user's Moodle calendar (ICS).
// The page cannot read mama.mta.ac.il itself (no CORS), so this reads it on the server side.
// It reads the link with the caller's own JWT (RLS: only their row), fetches only the college's calendar export, stores nothing and logs nothing.
const OK = /^https:\/\/mama\.mta\.ac\.il\/calendar\/export_execute\.php\?[^\s]*$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const out = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return out({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') ?? '', key = req.headers.get('apikey') ?? '';
  const base = Deno.env.get('SUPABASE_URL');
  const r = await fetch(`${base}/rest/v1/moodle_link?select=url`, { headers: { apikey: key, Authorization: auth } });
  if (!r.ok) return out({ error: 'link' }, 502);
  const rows = await r.json();
  const url = rows?.[0]?.url;
  if (!url) return out({ error: 'nolink' }, 404);
  if (!OK.test(url)) return out({ error: 'badlink' }, 400);
  let m: Response;
  try { m = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch { return out({ error: 'moodle' }, 502); }
  const text = await m.text();
  if (!m.ok) return out({ error: 'moodle', status: m.status }, 502);
  if (!/BEGIN:VCALENDAR/.test(text)) return out({ error: 'key' }, 422); // Moodle answers "Invalid authentication" with 200 when the key is reset or wrong
  return new Response(text, { headers: { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8' } });
});
