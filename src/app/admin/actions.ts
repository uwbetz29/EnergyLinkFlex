"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  system_role: string;
  provider: string;
  created_at: string;
  last_sign_in_at: string | null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("system_role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.system_role)) {
    throw new Error("Not authorized");
  }

  return { user, profile };
}

export async function listUsers(): Promise<AdminUser[]> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: false });

  const {
    data: { users: authUsers },
  } = await admin.auth.admin.listUsers();

  const authMap = new Map(authUsers.map((u) => [u.id, u]));

  return (profiles || []).map((p) => {
    const auth = authMap.get(p.id);
    return {
      id: p.id,
      email: p.email || auth?.email || "",
      display_name: p.display_name || "",
      avatar_url: p.avatar_url,
      system_role: p.system_role,
      provider: auth?.app_metadata?.provider || "email",
      created_at: p.created_at,
      last_sign_in_at: auth?.last_sign_in_at || null,
    };
  });
}

export async function updateUserRole(userId: string, newRole: string) {
  const { user, profile } = await requireAdmin();

  if (newRole === "super_admin" && profile.system_role !== "super_admin") {
    throw new Error("Only super admins can promote to super admin");
  }

  if (userId === user.id) {
    throw new Error("Cannot change your own role");
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("user_profiles")
    .select("system_role")
    .eq("id", userId)
    .single();

  if (
    target?.system_role === "super_admin" &&
    profile.system_role !== "super_admin"
  ) {
    throw new Error("Cannot modify a super admin");
  }

  const { error } = await admin
    .from("user_profiles")
    .update({ system_role: newRole, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

export async function createUser(
  email: string,
  password: string,
  displayName: string,
  role: string
) {
  const { profile } = await requireAdmin();

  if (role === "super_admin" && profile.system_role !== "super_admin") {
    throw new Error("Only super admins can create super admins");
  }

  const admin = createAdminClient();

  const { data: newUser, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (error) throw new Error(error.message);

  await admin.from("user_profiles").upsert({
    id: newUser.user.id,
    email,
    display_name: displayName,
    system_role: role,
  });

  return newUser.user.id;
}

export async function deleteUser(userId: string) {
  const { user } = await requireAdmin();

  if (userId === user.id) {
    throw new Error("Cannot delete yourself");
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("user_profiles")
    .select("system_role")
    .eq("id", userId)
    .single();

  if (target?.system_role === "super_admin") {
    throw new Error("Cannot delete a super admin");
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
