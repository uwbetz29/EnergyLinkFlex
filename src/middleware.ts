export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/debug-env|_next/static|_next/image|favicon.ico|login|auth/reset-password|auth/update-password|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|json|pdf|js|mjs)$).*)",
  ],
};
