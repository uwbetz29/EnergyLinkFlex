import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ? `set (${process.env.AUTH_GOOGLE_ID.length} chars)` : "NOT SET",
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ? `set (${process.env.AUTH_GOOGLE_SECRET.length} chars)` : "NOT SET",
    AUTH_SECRET: process.env.AUTH_SECRET ? `set (${process.env.AUTH_SECRET.length} chars)` : "NOT SET",
    DATABASE_URL: process.env.DATABASE_URL ? `set (${process.env.DATABASE_URL.length} chars)` : "NOT SET",
    NODE_ENV: process.env.NODE_ENV,
  });
}
