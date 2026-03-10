"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { AdminUser } from "./actions";
import {
  listUsers,
  updateUserRole,
  createUser as createUserAction,
  deleteUser as deleteUserAction,
} from "./actions";
import { CreateUserDialog } from "./create-user-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Search,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowLeft,
  Users,
  Mail,
  Clock,
  UserCheck,
  Trash2,
  ChevronLeft,
  Shield,
} from "lucide-react";

/* ─── Helpers ─── */

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    super_admin: "bg-red-50 text-red-700 border-red-200",
    admin: "bg-blue-50 text-blue-700 border-blue-200",
    member: "bg-gray-50 text-gray-600 border-gray-200",
  };
  const labels: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    member: "Member",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${styles[role] || styles.member}`}
    >
      {labels[role] || role}
    </span>
  );
}

type SortField =
  | "display_name"
  | "system_role"
  | "provider"
  | "created_at"
  | "last_sign_in_at";

/* ─── Admin Console ─── */

export function AdminConsole({
  initialUsers,
}: {
  initialUsers: AdminUser[];
}) {
  const { profile: myProfile } = useAuth();

  const [users, setUsers] = useState(initialUsers);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Derive role from the user list (auth-provider doesn't carry system_role)
  const myRole = users.find((u) => u.id === myProfile?.id)?.system_role;
  const isSuperAdmin = myRole === "super_admin";

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = a[sortField] || "";
      const bVal = b[sortField] || "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ArrowUpDown className="w-3.5 h-3.5 text-white/30" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-white" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-white" />
    );
  };

  const refreshUsers = async () => {
    const updated = await listUsers();
    setUsers(updated);
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setActionLoading(true);
    try {
      await updateUserRole(userId, newRole);
      await refreshUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    }
    setActionLoading(false);
  };

  const handleCreateUser = async (
    email: string,
    password: string,
    displayName: string,
    role: string
  ) => {
    setActionLoading(true);
    try {
      await createUserAction(email, password, displayName, role);
      await refreshUsers();
      setShowCreateDialog(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create user");
    }
    setActionLoading(false);
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setActionLoading(true);
    try {
      await deleteUserAction(userId);
      await refreshUsers();
      setSelectedUserId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
    setActionLoading(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ─── Sidebar ─── */}
      <aside
        className="w-[220px] flex-shrink-0 flex flex-col"
        style={{
          background: "linear-gradient(180deg, #001a4d 0%, #001030 100%)",
        }}
      >
        <div className="p-5 pb-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/50 hover:text-white text-sm
                       font-medium transition-colors mb-5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-white text-xl font-bold tracking-tight">Admin</h1>
        </div>

        <nav className="flex-1 px-3 mt-2">
          <button
            onClick={() => setSelectedUserId(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                        font-medium transition-colors ${
                          !selectedUserId
                            ? "bg-white/15 text-white"
                            : "text-white/50 hover:bg-white/8 hover:text-white/80"
                        }`}
          >
            <Users className="w-[18px] h-[18px]" />
            Users
            <span
              className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                !selectedUserId
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {users.length}
            </span>
          </button>
        </nav>

        <div className="p-4 text-[10px] text-white/20 text-center font-medium tracking-wider uppercase">
          EnergyLink FLEX
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <main
        className="flex-1 overflow-y-auto"
        style={{ background: "#f0f4fa" }}
      >
        {selectedUser ? (
          /* ──────── User Detail View ──────── */
          <div className="max-w-3xl mx-auto px-8 py-8">
            <button
              onClick={() => setSelectedUserId(null)}
              className="flex items-center gap-1.5 text-sm text-[#6b8ab8]
                         hover:text-[#001a4d] font-semibold transition-colors mb-6"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Users
            </button>

            {/* ── Profile card ── */}
            <div className="bg-white rounded-2xl border border-[rgba(0,60,160,0.10)] shadow-sm p-6 mb-5">
              <div className="flex items-start gap-4 mb-6">
                {selectedUser.avatar_url ? (
                  <img
                    src={selectedUser.avatar_url}
                    alt=""
                    className="w-14 h-14 rounded-full flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center
                               text-white text-xl font-bold flex-shrink-0"
                    style={{
                      background:
                        "linear-gradient(135deg, #1a5cb8 0%, #002e81 100%)",
                    }}
                  >
                    {(
                      selectedUser.display_name ||
                      selectedUser.email ||
                      "U"
                    )[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-[#001a4d] truncate">
                    {selectedUser.display_name || "—"}
                  </h2>
                  <p className="text-sm text-[#6b8ab8] truncate">
                    {selectedUser.email}
                  </p>
                </div>
                <RoleBadge role={selectedUser.system_role} />
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[#f8fafd] border border-[rgba(0,60,160,0.06)]">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-[#a5b8d4]" />
                  <div>
                    <div className="text-[11px] text-[#a5b8d4] uppercase tracking-wider font-semibold">
                      Provider
                    </div>
                    <div className="text-sm font-medium text-[#001a4d] capitalize">
                      {selectedUser.provider}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-[#a5b8d4]" />
                  <div>
                    <div className="text-[11px] text-[#a5b8d4] uppercase tracking-wider font-semibold">
                      Created
                    </div>
                    <div className="text-sm font-medium text-[#001a4d]">
                      {new Date(selectedUser.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <UserCheck className="w-4 h-4 text-[#a5b8d4]" />
                  <div>
                    <div className="text-[11px] text-[#a5b8d4] uppercase tracking-wider font-semibold">
                      Last Active
                    </div>
                    <div className="text-sm font-medium text-[#001a4d]">
                      {timeAgo(selectedUser.last_sign_in_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-4 h-4 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#a5b8d4] uppercase tracking-wider font-semibold">
                      Status
                    </div>
                    <div className="text-sm font-medium text-green-600">
                      Active
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Role section ── */}
            {selectedUser.id !== myProfile?.id &&
              selectedUser.system_role !== "super_admin" && (
                <div className="bg-white rounded-2xl border border-[rgba(0,60,160,0.10)] shadow-sm p-6 mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-[#a5b8d4]" />
                    <h3 className="text-sm font-bold text-[#001a4d]">Role</h3>
                  </div>
                  <div className="flex gap-2">
                    {(isSuperAdmin
                      ? ["member", "admin", "super_admin"]
                      : ["member", "admin"]
                    ).map((role) => (
                      <button
                        key={role}
                        onClick={() =>
                          handleRoleChange(selectedUser.id, role)
                        }
                        disabled={
                          actionLoading || selectedUser.system_role === role
                        }
                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                          selectedUser.system_role === role
                            ? "bg-[#002e81] border-[#002e81] text-white shadow-sm"
                            : "bg-white border-[rgba(0,60,160,0.15)] text-[#4a5b7a] hover:border-[#002e81]/40 hover:bg-[#002e81]/5"
                        } disabled:opacity-50`}
                      >
                        {role === "super_admin"
                          ? "Super Admin"
                          : role.charAt(0).toUpperCase() + role.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {/* ── Danger zone ── */}
            {selectedUser.id !== myProfile?.id &&
              selectedUser.system_role !== "super_admin" && (
                <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-6">
                  <h3 className="text-sm font-bold text-red-600 mb-1">
                    Danger Zone
                  </h3>
                  <p className="text-xs text-[#999] mb-4">
                    Permanently delete this user account. This cannot be undone.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleDeleteUser(
                        selectedUser.id,
                        selectedUser.display_name || selectedUser.email
                      )
                    }
                    disabled={actionLoading}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete User
                  </Button>
                </div>
              )}
          </div>
        ) : (
          /* ──────── Users List View ──────── */
          <div className="px-8 py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-[#001a4d]">Users</h2>
                <p className="text-sm text-[#6b8ab8] mt-0.5">
                  {users.length} total user{users.length !== 1 ? "s" : ""}
                </p>
              </div>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="h-9 bg-[#002e81] hover:bg-[#0a3d99] text-white gap-1.5 rounded-xl"
              >
                <Plus className="w-4 h-4" />
                Create User
              </Button>
            </div>

            {/* Search */}
            <div className="relative max-w-sm mb-5">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a5b8d4]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-10 h-10 bg-white border-[rgba(0,60,160,0.12)] rounded-xl"
              />
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-[rgba(0,60,160,0.10)] shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#001a4d]">
                    {(
                      [
                        ["display_name", "User"],
                        ["system_role", "Role"],
                        ["provider", "Provider"],
                        ["created_at", "Created"],
                        ["last_sign_in_at", "Last Active"],
                      ] as [SortField, string][]
                    ).map(([field, label]) => (
                      <th
                        key={field}
                        className="text-left px-4 py-3 text-[11px] font-semibold text-white/70
                                   uppercase tracking-wider cursor-pointer hover:text-white
                                   select-none transition-colors"
                        onClick={() => toggleSort(field)}
                      >
                        <span className="flex items-center gap-1.5">
                          {label} <SortIcon field={field} />
                        </span>
                      </th>
                    ))}
                    <th className="w-[1%] px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-[#f0f4fa] last:border-0
                                 hover:bg-[#f8fafd] cursor-pointer transition-colors group"
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {user.avatar_url ? (
                            <img
                              src={user.avatar_url}
                              alt=""
                              className="w-8 h-8 rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center
                                         text-white text-xs font-semibold flex-shrink-0"
                              style={{
                                background:
                                  "linear-gradient(135deg, #1a5cb8 0%, #002e81 100%)",
                              }}
                            >
                              {(
                                user.display_name ||
                                user.email ||
                                "U"
                              )[0].toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-[#001a4d] truncate">
                              {user.display_name || "—"}
                            </div>
                            <div className="text-xs text-[#a5b8d4] truncate">
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={user.system_role} />
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4a5b7a] capitalize">
                        {user.provider}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4a5b7a]">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4a5b7a]">
                        {timeAgo(user.last_sign_in_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {user.system_role !== "super_admin" &&
                            user.id !== myProfile?.id && (
                              <button
                                className="p-1.5 rounded-lg hover:bg-red-50 text-[#a5b8d4]
                                           hover:text-red-500 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUser(
                                    user.id,
                                    user.display_name || user.email
                                  );
                                }}
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-12 text-center text-[#a5b8d4] text-sm"
                      >
                        {search
                          ? "No users match your search."
                          : "No users found."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Create User Dialog */}
      <CreateUserDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateUser}
        isSuperAdmin={isSuperAdmin}
        loading={actionLoading}
      />
    </div>
  );
}
