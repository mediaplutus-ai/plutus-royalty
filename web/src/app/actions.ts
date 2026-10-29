"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!supabaseConfigured()) redirect("/dashboard");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "That email and password don't match. Check them and try again." };

  const h = await headers();
  await supabase.rpc("log_event", {
    p_action: "LOGIN",
    p_ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    p_user_agent: h.get("user-agent"),
  });

  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.rpc("log_event", { p_action: "LOGOUT" });
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/** Demo mode only: look at the dashboard as a different role. */
export async function switchDemoRole(formData: FormData) {
  if (supabaseConfigured()) return;
  const role = String(formData.get("role")) as AppRole;
  (await cookies()).set("demo_role", role, { path: "/", sameSite: "lax" });
  redirect("/dashboard");
}
