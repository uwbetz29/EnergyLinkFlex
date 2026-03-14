import { NextResponse } from "next/server";

export async function GET() {
  const googleId = process.env.AUTH_GOOGLE_ID;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  const authSecret = process.env.AUTH_SECRET;

  // Try to fetch Google OIDC discovery
  let discovery = "not tested";
  let discoveryError = null;
  try {
    const res = await fetch("https://accounts.google.com/.well-known/openid-configuration");
    discovery = `status: ${res.status}`;
    if (!res.ok) {
      discoveryError = await res.text();
    }
  } catch (e: unknown) {
    discovery = "FAILED";
    discoveryError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    AUTH_GOOGLE_ID: googleId ? `set (${googleId.length} chars, starts with: ${googleId.substring(0, 10)}...)` : "NOT SET",
    AUTH_GOOGLE_SECRET: googleSecret ? `set (${googleSecret.length} chars, starts with: ${googleSecret.substring(0, 6)}...)` : "NOT SET",
    AUTH_SECRET: authSecret ? `set (${authSecret.length} chars)` : "NOT SET",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "NOT SET",
    AUTH_URL: process.env.AUTH_URL || "NOT SET",
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || "NOT SET",
    VERCEL_URL: process.env.VERCEL_URL || "NOT SET",
    NODE_ENV: process.env.NODE_ENV,
    oidcDiscovery: discovery,
    discoveryError,
  });
}
