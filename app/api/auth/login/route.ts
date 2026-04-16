import { NextRequest, NextResponse } from "next/server";
import { login, setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username et password requis" }, { status: 400 });
    }

    const result = await login(username, password);
    if (!result) {
      return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
    }

    await setSessionCookie(result.token);
    return NextResponse.json({ ok: true, userId: result.userId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erreur" }, { status: 500 });
  }
}