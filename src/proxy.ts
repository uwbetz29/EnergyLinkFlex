import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // Public routes that don't need auth
  const isPublic = ["/login", "/auth/reset-password", "/auth/update-password"].some(
    (p) => pathname.startsWith(p)
  );

  if (isPublic) return NextResponse.next();

  // Redirect to login if not authenticated
  if (!session?.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|login|auth/reset-password|auth/update-password|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|json|pdf|js|mjs)$).*)",
  ],
};
