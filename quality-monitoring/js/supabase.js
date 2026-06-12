/* ============================================================
   SUPABASE — Singleton do cliente
   ============================================================ */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* Local dev: copy config.local.example.js → config.local.js and fill in real values.
   In production the CI injects values into config.js via sed — no config.local.js exists. */
let _url, _key;
try {
  const local = await import('./config.local.js');
  _url  = local.SUPABASE_URL;
  _key  = local.SUPABASE_PUBLISHABLE_KEY;
} catch {
  const cfg = await import('./config.js');
  _url  = cfg.SUPABASE_URL;
  _key  = cfg.SUPABASE_PUBLISHABLE_KEY;
}

export const supabase = createClient(_url, _key);
