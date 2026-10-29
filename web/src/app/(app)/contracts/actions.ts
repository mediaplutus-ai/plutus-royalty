"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { actor, codes, friendly, opt, str } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";

const TYPES = ["publishing", "co_publishing", "administration", "sub_publishing", "distribution"];
const STATUSES = ["draft", "active", "expired", "terminated"];

/** Plutus team only: create or change a contract (commission terms). */
export async function saveContract(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await actor("super_admin");
    const party = str(fd, "party"); // "label:<id>" or "artist:<id>"
    const [kind, partyId] = party.split(":");
    if (!partyId || (kind !== "label" && kind !== "artist")) return { error: "Choose who the contract is with." };

    const pct = Number(str(fd, "commission_pct"));
    if (!(pct >= 0 && pct <= 100)) return { error: "Commission must be between 0 and 100%." };
    const type = str(fd, "contract_type");
    const status = str(fd, "status");
    if (!TYPES.includes(type)) return { error: "Choose the contract type." };
    if (!STATUSES.includes(status)) return { error: "Choose the status." };
    const effective = str(fd, "effective_date");
    if (!effective) return { error: "Enter the effective date." };

    const sb = await createClient();
    let labelId: string | null = kind === "label" ? partyId : null;
    if (kind === "artist") {
      const { data } = await sb.from("artists").select("label_id").eq("id", partyId).maybeSingle();
      labelId = data?.label_id ?? null;
    }
    const row = {
      label_id: labelId,
      artist_id: kind === "artist" ? partyId : null,
      contract_type: type,
      commission_pct: pct,
      effective_date: effective,
      end_date: opt(fd, "end_date"),
      territories: codes(str(fd, "territories") || "WORLD"),
      status,
      notes: opt(fd, "notes"),
    };
    const { error } = id ? await sb.from("contracts").update(row).eq("id", id) : await sb.from("contracts").insert(row);
    if (error) return { error: friendly(error.message) };
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  redirect("/contracts?saved=1");
}
