"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/forms";
import { actor, friendly } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";

const pctFrom = (fd: FormData) => Number(String(fd.get("pct") ?? "").replace(",", "."));
const changed = (n: number) => (n === 0 ? "No open royalties needed a change." : `${n} open royalty ${n === 1 ? "line" : "lines"} re-calculated.`);

export async function setDefaultCommission(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const pct = pctFrom(fd);
    if (!(pct >= 0 && pct <= 100)) return { error: "Enter a % between 0 and 100." };
    const sb = await createClient();
    const { data, error } = await sb.rpc("set_default_commission", { p_pct: pct });
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: `Default is now ${pct}%. ${changed(Number(data))}` };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
}

export async function setClientCommission(kind: "label" | "artist", id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const pct = pctFrom(fd);
    if (!(pct >= 0 && pct <= 100)) return { error: "0–100 only" };
    const sb = await createClient();
    const { data, error } = await sb.rpc("set_client_commission", {
      p_label: kind === "label" ? id : null,
      p_artist: kind === "artist" ? id : null,
      p_pct: pct,
    });
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: `Saved. ${changed(Number(data))}` };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
}
