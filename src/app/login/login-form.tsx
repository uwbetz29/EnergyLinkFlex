"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(() => createClient());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const urlError = searchParams.get("error");

  const handleGoogleLogin = async () => {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) setError(error.message);
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    } else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <div className="brand-bg min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="flex justify-center mb-6 animate-rise animate-rise-1">
          <Image
            src="/logo.png"
            alt="EnergyLink FLEX"
            width={418}
            height={156}
            className="w-[clamp(180px,40vw,280px)] h-auto"
            priority
          />
        </div>

        {/* Subtitle */}
        <p className="text-center text-[#6b8ab8] text-sm font-semibold mb-6 animate-rise animate-rise-2">
          Sign in and let&apos;s get to work!
        </p>

        {/* Glass card */}
        <div className="glass-card rounded-[24px] p-8 animate-rise animate-rise-3">
          {/* Google OAuth */}
          <button
            onClick={handleGoogleLogin}
            type="button"
            className="w-full h-11 flex items-center justify-center gap-2
                       bg-white rounded-full border-[1.5px] border-[rgba(0,60,160,0.15)]
                       text-sm font-semibold text-[#001a4d]
                       hover:-translate-y-[1px] hover:shadow-md
                       active:translate-y-0
                       transition-all duration-150 cursor-pointer mb-5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[rgba(0,60,160,0.12)]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white/80 px-3 text-[#a5b8d4]">
                or sign in with email
              </span>
            </div>
          </div>

          {/* Error */}
          {(error || urlError) && (
            <div className={`mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600 ${error ? "animate-shake" : ""}`}>
              {error || "Authentication failed. Please try again."}
            </div>
          )}

          {/* Email/Password Form */}
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#4a5b7a] mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full h-11 px-4 rounded-full text-sm
                           bg-white/70 border-[1.5px] border-[rgba(0,60,160,0.15)]
                           text-[#001a4d] placeholder-[#a5b8d4]
                           focus:outline-none focus:border-[#1a5cb8] focus:ring-2 focus:ring-[rgba(0,46,129,0.15)]
                           transition-all duration-150"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#4a5b7a]">
                  Password
                </label>
                <Link
                  href="/auth/reset-password"
                  className="text-[11px] font-semibold text-[#1a5cb8] hover:text-[#002e81] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
                autoComplete="current-password"
                className="w-full h-11 px-4 rounded-full text-sm
                           bg-white/70 border-[1.5px] border-[rgba(0,60,160,0.15)]
                           text-[#001a4d] placeholder-[#a5b8d4]
                           focus:outline-none focus:border-[#1a5cb8] focus:ring-2 focus:ring-[rgba(0,46,129,0.15)]
                           transition-all duration-150"
              />
            </div>

            {/* Sign In button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-sm font-bold text-white
                         hover:-translate-y-[1px] active:translate-y-0
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-150 cursor-pointer mt-2"
              style={{
                background: "linear-gradient(135deg, #1a5cb8 0%, #002e81 100%)",
                boxShadow: "0 4px 16px rgba(0,46,129,0.3)",
              }}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-[11px] text-[#b5c4db] animate-rise animate-rise-5">
          EnergyLink International
        </div>
      </div>
    </div>
  );
}
