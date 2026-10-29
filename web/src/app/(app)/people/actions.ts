"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { actor, friendly, opt, str } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["super_admin", "label_admin", "author_composer"];

export async function createInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("super_admin", "label_admin");
    const email = str(fd, "email").toLowerCase();
    if (!email) return { error: "Enter the person's email address." };

    let role = str(fd, "role") as AppRole;
    let labelId = opt(fd, "label_id");
    if (me.role === "label_admin") {
      role = "author_composer";
      labelId = me.labelId ?? null;
    }
    if (!ROLES.includes(role)) return { error: "Choose a role." };
    if (role === "label_admin" && !labelId) return { error: "A Label Admin must belong to a label. Choose the label." };

    const sb = await createClient();
    const { error } = await sb.from("invitations").insert({
      email,
      full_name: opt(fd, "full_name"),
      role,
      label_id: role === "super_admin" ? null : labelId,
      artist_id: role === "author_composer" ? opt(fd, "artist_id") : null,
    });
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: `Invitation for ${email} is ready. Copy its link from the list below and send it on WhatsApp or email.` };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
}

export async function revokeInvitation(id: string) {
  await actor("super_admin", "label_admin");
  const sb = await createClient();
  await sb.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function updateAccess(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("super_admin");
    const role = str(fd, "role") as AppRole;
    const labelId = opt(fd, "label_id");
    const isActive = str(fd, "is_active") === "on";
    if (!ROLES.includes(role)) return { error: "Choose a role." };
    if (id === me.id && (role !== "super_admin" || !isActive)) {
      return { error: "You cannot remove your own Super Admin access. Ask another Super Admin." };
    }
    if (role === "label_admin" && !labelId) return { error: "A Label Admin must belong to a label." };

    const sb = await createClient();
    const { error } = await sb
      .from("profiles")
      .update({ role, label_id: role === "super_admin" ? null : labelId, is_active: isActive })
      .eq("id", id);
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: "Saved." };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
}

export async function createLabel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const name = str(fd, "name");
    if (!name) return { error: "Enter the label name." };
    const sb = await createClient();
    const { error } = await sb.from("labels").insert({
      name,
      legal_name: opt(fd, "legal_name"),
      contact_email: opt(fd, "contact_email"),
      contact_phone: opt(fd, "contact_phone"),
      gstin: opt(fd, "gstin")?.toUpperCase() ?? null,
    });
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: `${name} added.` };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
}

/** Create (no id) or update a rights holder. */
export async function saveArtist(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let savedId = id;
  try {
    const me = await actor("super_admin", "label_admin");
    const stageName = str(fd, "stage_name");
    if (!stageName) return { error: "Enter the name the rights holder is known by." };
    const row = {
      stage_name: stageName,
      legal_name: opt(fd, "legal_name"),
      email: opt(fd, "email")?.toLowerCase() ?? null,
      phone: opt(fd, "phone"),
      ipi_number: opt(fd, "ipi_number")?.replace(/\s/g, "") ?? null,
      society: opt(fd, "society")?.toUpperCase() ?? null,
      label_id: me.role === "label_admin" ? (me.labelId ?? null) : opt(fd, "label_id"),
      is_active: id ? str(fd, "is_active") === "on" : true,
    };
    const sb = await createClient();
    if (id) {
      const { error } = await sb.from("artists").update(row).eq("id", id);
      if (error) return { error: friendly(error.message) };
    } else {
      const { data, error } = await sb.from("artists").insert(row).select("id").single();
      if (error) return { error: friendly(error.message) };
      savedId = data.id;
    }
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  if (!id) redirect(`/people?tab=holders&added=${savedId}`);
  refresh();
  return { ok: "Saved." };
}
