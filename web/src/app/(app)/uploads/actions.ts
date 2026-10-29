"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actor, friendly } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";

async function call(fn: string, id: string) {
  await actor("super_admin");
  const sb = await createClient();
  const { error } = await sb.rpc(fn, { p_report: id });
  return error ? friendly(error.message) : null;
}

export async function publishReport(id: string) {
  const err = await call("publish_report", id);
  redirect(`/uploads/${id}?${err ? `error=${encodeURIComponent(err)}` : "published=1"}`);
}

export async function unpublishReport(id: string) {
  const err = await call("unpublish_report", id);
  redirect(`/uploads/${id}?${err ? `error=${encodeURIComponent(err)}` : "hidden=1"}`);
}

export async function deleteReport(id: string) {
  const err = await call("delete_report", id);
  if (err) redirect(`/uploads/${id}?error=${encodeURIComponent(err)}`);
  redirect("/uploads?deleted=1");
}

/** Publish every checked report that is still hidden. */
export async function publishAllReady() {
  await actor("super_admin");
  const sb = await createClient();
  const { data } = await sb.from("royalty_reports").select("id").is("published_at", null).eq("status", "processed");
  for (const r of data ?? []) await sb.rpc("publish_report", { p_report: r.id });
  refresh();
}
