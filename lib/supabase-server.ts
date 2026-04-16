import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase côté SERVEUR avec service_role.
 * Bypass le RLS — à utiliser UNIQUEMENT côté serveur (jamais exposé au browser).
 * Utilisé par :
 *  - /api/update (cron job, process les snapshots pour tous les users)
 *  - /api/auth/* (login, sessions, etc.)
 */
export function createServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,   // ★ service_role, pas anon
    { auth: { persistSession: false } }
  );
}