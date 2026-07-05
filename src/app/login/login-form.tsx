"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Image from "next/image";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const urlError = searchParams.get("error");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email: username,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid username or password");
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
          {/* Error */}
          {(error || urlError) && (
            <div className={`mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600 ${error ? "animate-shake" : ""}`}>
              {error || "Authentication failed. Please try again."}
            </div>
          )}

          {/* Username/Password Form */}
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#4a5b7a] mb-1.5 block">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                required
                autoComplete="username"
                autoFocus
                className="w-full h-11 px-4 rounded-full text-sm
                           bg-white/70 border-[1.5px] border-[rgba(0,60,160,0.15)]
                           text-[#001a4d] placeholder-[#a5b8d4]
                           focus:outline-none focus:border-[#1a5cb8] focus:ring-2 focus:ring-[rgba(0,46,129,0.15)]
                           transition-all duration-150"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#4a5b7a] mb-1.5 block">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
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
