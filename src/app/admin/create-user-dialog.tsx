"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (
    email: string,
    password: string,
    displayName: string,
    role: string
  ) => Promise<void>;
  isSuperAdmin: boolean;
  loading: boolean;
}

export function CreateUserDialog({
  open,
  onClose,
  onCreate,
  isSuperAdmin,
  loading,
}: CreateUserDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim() || !displayName.trim()) {
      setError("All fields are required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    try {
      await onCreate(email.trim(), password, displayName.trim(), role);
      setDisplayName("");
      setEmail("");
      setPassword("");
      setRole("member");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    }
  };

  const handleClose = () => {
    setDisplayName("");
    setEmail("");
    setPassword("");
    setRole("member");
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-[#555] mb-1 block">
              Display Name
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[#555] mb-1 block">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[#555] mb-1 block">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2 block">
              Role
            </label>
            <div className="flex gap-2">
              {(isSuperAdmin
                ? ["member", "admin", "super_admin"]
                : ["member", "admin"]
              ).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    role === r
                      ? "bg-[#002e81]/10 border-[#002e81] text-[#001a4d]"
                      : "bg-white border-[#E7E7E7] text-[#666] hover:border-[#002e81]/40 hover:bg-[#002e81]/5"
                  }`}
                >
                  {r === "super_admin"
                    ? "Super Admin"
                    : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-[#002e81] hover:bg-[#0a3d99] text-white"
            >
              {loading ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
