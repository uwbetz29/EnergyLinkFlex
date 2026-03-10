import { type NextRequest, NextResponse } from "next/server";

const publicRoutes = [
  "/login",
  "/auth/callback",
  "/auth/reset-password",
  "/auth/update-password",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — always pass through
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Protected routes — check for Supabase session cookie presence.
  // No network calls here. Actual JWT validation happens via Supabase RLS
  // when the client makes data requests.
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|json|pdf|js|mjs)$).*)",
  ],
};
