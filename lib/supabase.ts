"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase qui injecte le header `x-session-token` dans CHAQUE requête
 * via un fetch intercepté (plus fiable que global.headers sur Supabase JS v2).
 *
 * Le token est géré via une closure — on peut l'updater dynamiquement avec
 * setSupabaseSessionToken() sans recréer le client.
 */

let _token: string | null = null;

/** Permet de changer le token sans recréer le client. */
export function setSupabaseSessionToken(token: string | null) {
  _token = token;
  if (typeof window !== "undefined") {
    (window as any).__ptftrack_token = token; // debug facilité
  }
}

// Custom fetch qui injecte systématiquement le header
const customFetch: typeof fetch = (input, init) => {
  // Merge headers proprement : on prend ceux de init, et on ajoute x-session-token
  const headers = new Headers(init?.headers);
  if (_token) {
    headers.set("x-session-token", _token);
  }
  return fetch(input, { ...init, headers });
};

export const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: { persistSession: false },
    global: {
      fetch: customFetch,
    },
  }
);