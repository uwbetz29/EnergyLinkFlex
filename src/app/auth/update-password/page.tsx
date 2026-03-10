"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
    } else {
      router.push("/");
    }
    setLoading(false);
  };

  return (
    <div className="brand-bg min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
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

        <div className="glass-card rounded-[24px] p-8 animate-rise animate-rise-3">
          <h2 className="text-lg font-bold text-[#001a4d] mb-2">
            Set New Password
          </h2>
          <p className="text-sm text-[#6b8ab8] mb-6">
            Enter your new password below.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600 animate-shake">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#4a5b7a] mb-1.5 block">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                autoFocus
                autoComplete="new-password"
                className="w-full h-11 px-4 rounded-full text-sm
                           bg-white/70 border-[1.5px] border-[rgba(0,60,160,0.15)]
                           text-[#001a4d] placeholder-[#a5b8d4]
                           focus:outline-none focus:border-[#1a5cb8] focus:ring-2 focus:ring-[rgba(0,46,129,0.15)]
                           transition-all duration-150"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#4a5b7a] mb-1.5 block">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
                className="w-full h-11 px-4 rounded-full text-sm
                           bg-white/70 border-[1.5px] border-[rgba(0,60,160,0.15)]
                           text-[#001a4d] placeholder-[#a5b8d4]
                           focus:outline-none focus:border-[#1a5cb8] focus:ring-2 focus:ring-[rgba(0,46,129,0.15)]
                           transition-all duration-150"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-sm font-bold text-white
                         hover:-translate-y-[1px] active:translate-y-0
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-150 cursor-pointer"
              style={{
                background: "linear-gradient(135deg, #1a5cb8 0%, #002e81 100%)",
                boxShadow: "0 4px 16px rgba(0,46,129,0.3)",
              }}
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
