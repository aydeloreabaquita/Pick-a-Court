import { ApiError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  if (error || !subject) throw new ApiError(401, "Authentication required", "unauthorized");
  return { supabase, userId: subject };
}

export async function requireAdmin() {
  const session = await requireUser();
  const { data, error } = await session.supabase
    .from("profiles")
    .select("role")
    .eq("id", session.userId)
    .single();
  if (error || data?.role !== "admin") {
    throw new ApiError(403, "Administrator access required", "forbidden");
  }
  return session;
}
