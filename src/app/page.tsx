"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import {
  Settings,
  LogOut,
  Plus,
  FolderOpen,
  ChevronDown,
} from "lucide-react";
import { NewProjectDialog } from "./new-project-dialog";
import { OpenProjectDialog } from "./open-project-dialog";

function getGreeting(displayName?: string): string {
  const hour = new Date().getHours();
  const firstName = displayName?.split(" ")[0] || "";
  let timeOfDay: string;

  if (hour >= 5 && hour < 12) {
    timeOfDay = "Good morning";
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = "Good afternoon";
  } else {
    timeOfDay = "Good evening";
  }

  const name = firstName ? ` ${firstName}` : "";
  return `\u2615 ${timeOfDay}${name} \u2014 what are we working on?`;
}

function UserMenu() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initial = (profile?.display_name?.[0] || profile?.email?.[0] || "U").toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full
                   bg-white/50 border border-[rgba(0,60,160,0.15)]
                   hover:bg-white/70 transition-all duration-150 cursor-pointer"
      >
        {/* Avatar circle */}
        <div
          className="w-[26px] h-[26px] rounded-full flex items-center justify-center
                     text-white text-xs font-semibold shrink-0"
          style={{ background: "linear-gradient(135deg, #1a5cb8 0%, #002e81 100%)" }}
        >
          {initial}
        </div>
        <span className="text-sm font-semibold text-[#001a4d] max-w-[100px] truncate">
          {profile?.display_name || "User"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[#4a7ab8]" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 rounded-[14px] p-1.5
                     bg-white/92 backdrop-blur-[14px] border border-[rgba(0,60,160,0.18)]
                     shadow-lg z-50 animate-rise"
          style={{
            boxShadow:
              "0 4px 20px rgba(0,30,100,0.12), 0 2px 6px rgba(0,30,100,0.08)",
          }}
        >
          {/* Email */}
          <div className="px-3.5 py-2 border-b border-[rgba(0,60,160,0.10)]">
            <div className="text-[11px] text-[#888] truncate">{profile?.email}</div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              router.push("/admin");
            }}
            className="w-full text-left px-3.5 py-2.5 rounded-[10px] text-[13px] font-semibold
                       text-[#001a4d] hover:bg-[rgba(0,46,129,0.08)] transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4 inline-block mr-2 -mt-0.5 text-[#4a7ab8]" />
            Admin
          </button>

          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="w-full text-left px-3.5 py-2.5 rounded-[10px] text-[13px] font-semibold
                       text-[#001a4d] hover:bg-[rgba(0,46,129,0.08)] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 inline-block mr-2 -mt-0.5 text-[#4a7ab8]" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { profile, isLoading } = useAuth();
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="brand-bg min-h-screen flex items-center justify-center">
        <div className="text-[#7a9fd0] text-sm animate-rise">Loading...</div>
      </div>
    );
  }

  return (
    <div className="brand-bg min-h-screen flex flex-col relative">
      {/* Top bar */}
      <div className="absolute top-0 right-0 p-5 z-10 animate-rise animate-rise-3">
        <UserMenu />
      </div>

      {/* Center content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        {/* Logo */}
        <div className="animate-rise animate-rise-1 mb-6">
          <Image
            src="/logo.png"
            alt="EnergyLink FLEX"
            width={418}
            height={156}
            className="w-[clamp(160px,30vw,240px)] h-auto"
            priority
          />
        </div>

        {/* Greeting */}
        <p
          className="animate-rise animate-rise-2 text-center mb-10"
          style={{
            fontWeight: 100,
            fontSize: "clamp(20px, 3vw, 28px)",
            color: "#001a4d",
          }}
        >
          {getGreeting(profile?.display_name)}
        </p>

        {/* Action cards */}
        <div className="animate-rise animate-rise-3 grid grid-cols-2 gap-5 w-full max-w-[480px]">
          {/* New Project */}
          <button
            onClick={() => setNewOpen(true)}
            className="glass-card rounded-[20px] p-8 text-center
                       hover:-translate-y-1 transition-all duration-200
                       cursor-pointer group"
          >
            <div className="text-[32px] text-[#1a5cb8] mb-3 group-hover:scale-110 transition-transform">
              <Plus className="w-8 h-8 mx-auto" strokeWidth={2.5} />
            </div>
            <div className="text-[17px] font-bold text-[#001a4d] mb-1">
              New Project
            </div>
            <div className="text-[13px] text-[#6b8ab8]">
              Start a fresh project from scratch
            </div>
          </button>

          {/* Open Project */}
          <button
            onClick={() => setOpenOpen(true)}
            className="glass-card rounded-[20px] p-8 text-center
                       hover:-translate-y-1 transition-all duration-200
                       cursor-pointer group"
          >
            <div className="text-[32px] text-[#1a5cb8] mb-3 group-hover:scale-110 transition-transform">
              <FolderOpen className="w-8 h-8 mx-auto" strokeWidth={2} />
            </div>
            <div className="text-[17px] font-bold text-[#001a4d] mb-1">
              Open Project
            </div>
            <div className="text-[13px] text-[#6b8ab8]">
              Continue where you left off
            </div>
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="animate-rise animate-rise-5 text-center pb-10 pt-4">
        <div className="text-[11px] text-[#b5c4db]">
          EnergyLink International &middot; v0.1.0
        </div>
      </footer>

      {/* Dialogs */}
      <NewProjectDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => router.push(`/editor?project=${id}`)}
      />
      <OpenProjectDialog
        open={openOpen}
        onClose={() => setOpenOpen(false)}
      />
    </div>
  );
}
