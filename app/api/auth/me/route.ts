import { NextResponse } from "next/server";
import { getCurrentUser, getSessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null, token: null });

  // On renvoie aussi le token de session pour que le client puisse
  // l'injecter dans les headers Supabase (pour le RLS)
  const token = await getSessionToken();
  return NextResponse.json({ user, token });
}