"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";

/** Creates the account for an invited person. The database switches it on only with a valid token. */
export async function acceptInvitation(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 8) return { error: "Choose a password of at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords are different. Type the same password twice." };

  const sb = await createClient();
  const { data: rows } = await sb.rpc("invitation_preview", { p_token: token });
  const inv = Array.isArray(rows) ? rows[0] : rows;
  if (!inv || !inv.is_valid) return { error: "This invitation link has expired or was already used. Ask Plutus for a new one." };

  const { data, error } = await sb.auth.signUp({
    email: inv.email,
    password,
    options: { data: { invite_token: token, full_name: inv.full_name ?? undefined } },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return { error: "An account with this email already exists. Sign in instead, or ask Plutus to reset it." };
    }
    return { error: error.message };
  }
  if (!data.session) {
    return {
      ok: "Account created. Supabase asked to confirm the email address first: open the confirmation email, then sign in.",
    };
  }
  await sb.rpc("log_event", { p_action: "INVITE_ACCEPTED" });
  redirect("/dashboard");
}
