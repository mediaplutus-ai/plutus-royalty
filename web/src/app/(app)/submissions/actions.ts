"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { actor, codes, friendly, opt, str } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";

const WRITER_ROLES = ["composer", "author", "composer_author"];

/** Create (no id) or edit-and-resubmit a work submission. Files are already uploaded by the browser. */
export async function saveSubmission(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let savedId = id;
  try {
    const me = await actor();
    const title = str(fd, "title");
    if (!title) return { error: "Enter the song title." };

    const names = fd.getAll("writer_name").map((v) => String(v).trim());
    const ipis = fd.getAll("writer_ipi").map((v) => String(v).replace(/\s/g, ""));
    const roles = fd.getAll("writer_role").map(String);
    const shares = fd.getAll("writer_share").map(String);
    const artistIds = fd.getAll("writer_artist").map(String);
    const writers = names
      .map((name, i) => ({
        name,
        ipi: ipis[i] || undefined,
        role: WRITER_ROLES.includes(roles[i]) ? roles[i] : "composer_author",
        share_pct: Number(shares[i]),
        artist_id: artistIds[i] || undefined,
      }))
      .filter((w) => w.name);
    if (!writers.length) return { error: "Add at least one writer or composer with a share." };
    if (writers.some((w) => !(w.share_pct > 0 && w.share_pct <= 100))) return { error: "Every writer needs a share between 0 and 100." };
    const total = writers.reduce((t, w) => t + w.share_pct, 0);
    if (total > 100.0001) return { error: `Writer shares add up to ${total}%. The limit is 100%.` };

    // Kept files must already belong to this submission; new files must sit in the
    // uploader's own folder. Otherwise someone could attach another person's file
    // path and gain read access to it through the label rule.
    const sb = await createClient();
    let existing: string[] = [];
    if (id) {
      const { data } = await sb.from("work_submissions").select("files").eq("id", id).maybeSingle();
      existing = data?.files ?? [];
    }
    const kept = fd.getAll("keep_file").map(String).filter((p) => existing.includes(p));
    const added = fd.getAll("file_path").map(String).filter((p) => p.startsWith(`${me.id}/`) && !p.includes(".."));
    const files = [...new Set([...kept, ...added])];

    const row = {
      title,
      language: opt(fd, "language"),
      release_date: opt(fd, "release_date"),
      isrc: codes(str(fd, "isrc")),
      notes: opt(fd, "notes"),
      writers,
      files,
    };
    if (id) {
      const { error } = await sb.from("work_submissions").update(row).eq("id", id);
      if (error) return { error: friendly(error.message) };
    } else {
      const { data, error } = await sb.from("work_submissions").insert(row).select("id").single();
      if (error) return { error: friendly(error.message) };
      savedId = data.id;
    }
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  redirect(`/submissions/${savedId}?saved=1`);
}

/** Plutus team: move a submission along (under review / needs changes). */
export async function reviewSubmission(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const status = str(fd, "status");
    const note = opt(fd, "reviewer_note");
    if (!["under_review", "needs_changes", "submitted"].includes(status)) return { error: "Choose what to do." };
    if (status === "needs_changes" && !note) return { error: "Write what the writer should change." };
    const sb = await createClient();
    const { data: me } = await sb.auth.getUser();
    const { error } = await sb
      .from("work_submissions")
      .update({
        status,
        reviewer_note: status === "needs_changes" ? note : null,
        reviewed_by: me.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { error: friendly(error.message) };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  refresh();
  return { ok: "Updated. The writer has been notified." };
}

/** Plutus team: IPRS registered the work — create the catalog entry with its ISWC. */
export async function registerSubmission(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const iswc = str(fd, "iswc").toUpperCase();
    if (!/^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(iswc)) return { error: "ISWC should look like T-123.456.789-0." };
    const sb = await createClient();
    const { error } = await sb.rpc("register_submission", { p_submission: id, p_iswc: iswc });
    if (error) return { error: friendly(error.message) };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  refresh();
  return { ok: "Registered. The work is now in the catalog and royalties will match to it." };
}

/** Writer withdraws a submission before review starts; its files are removed too. */
export async function withdrawSubmission(id: string) {
  await actor();
  const sb = await createClient();
  const { data } = await sb.from("work_submissions").select("files").eq("id", id).maybeSingle();
  const { error } = await sb.from("work_submissions").delete().eq("id", id);
  if (!error && data?.files?.length) await sb.storage.from("work-submissions").remove(data.files);
  redirect("/submissions?withdrawn=1");
}
