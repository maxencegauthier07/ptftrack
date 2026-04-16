import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

/**
 * Client Supabase avec la service_role key — BYPASS le RLS
 * À utiliser UNIQUEMENT côté serveur, jamais côté client.
 * Pour les opérations d'auth (login, création de session, etc.)
 */
export function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // ★ Nouvelle env var à ajouter
    { auth: { persistSession: false } }
  );
}

/**
 * Client Supabase "authenticated" qui injecte l'user_id dans le GUC
 * Les policies RLS verront cet user_id via current_setting('app.user_id')
 */
export function getUserSupabase(userId: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      global: {
        headers: {
          // Pass user_id via header — on définit le GUC côté DB via une fonction
          "x-user-id": userId,
        },
      },
    }
  );
  return sb;
}

// ---------- COOKIES ----------
const COOKIE_NAME = "ptf_session";
const SESSION_DAYS = 30;

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value || null;
}

// ---------- AUTH ----------

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Login : vérifie username + mdp, crée une session, renvoie le token */
export async function login(username: string, password: string): Promise<{ userId: string; token: string } | null> {
  const sb = getServiceSupabase();

  // 1. Trouver le user
  const { data: user } = await sb.from("users")
    .select("id, password_hash")
    .eq("username", username.toLowerCase().trim())
    .single();

  if (!user) return null;

  // 2. Vérifier le password
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  // 3. Créer une session
  const token = randomBytes(48).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);

  await sb.from("sessions").insert({
    user_id: user.id,
    token,
    expires_at: expires.toISOString(),
  });

  return { userId: user.id, token };
}

/** Valide un token et retourne l'user_id, ou null */
export async function validateSession(token: string): Promise<string | null> {
  if (!token) return null;
  const sb = getServiceSupabase();
  const { data } = await sb.from("sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    // Session expirée : la supprimer
    await sb.from("sessions").delete().eq("token", token);
    return null;
  }
  return data.user_id;
}

/** Logout : supprime la session */
export async function logout(token: string) {
  if (!token) return;
  const sb = getServiceSupabase();
  await sb.from("sessions").delete().eq("token", token);
}

/** Récupère l'user courant à partir du cookie */
export async function getCurrentUser() {
  const token = await getSessionToken();
  if (!token) return null;
  const userId = await validateSession(token);
  if (!userId) return null;

  const sb = getServiceSupabase();
  const { data } = await sb.from("users")
    .select("id, username, display_name, is_admin")
    .eq("id", userId)
    .single();
  return data;
}