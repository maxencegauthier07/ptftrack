import { NextResponse } from "next/server";
import { getSessionToken, clearSessionCookie, logout } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const token = await getSessionToken();
  if (token) await logout(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}