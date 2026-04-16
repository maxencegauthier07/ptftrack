import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware Next.js — s'exécute avant CHAQUE requête.
 *
 * Rôle :
 *  - Redirige vers /login si pas de cookie de session
 *  - Les routes /login, /api/auth/* et les fichiers statiques sont libres
 */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Whitelist : ces routes n'ont pas besoin d'auth
  const publicPaths = [
    "/login",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/_next",
    "/favicon.ico",
  ];
  if (publicPaths.some(p => path.startsWith(p))) {
    return NextResponse.next();
  }

  // Vérifie la présence du cookie (pas sa validité — ça c'est fait côté API)
  const token = req.cookies.get("ptf_session")?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match toutes les routes sauf les fichiers publics
     * (fichiers avec extension, _next, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};