"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { actor, codes, friendly, opt, str } from "@/lib/actions-util";
import { createClient } from "@/lib/supabase/server";

/** Saves the work and its full ownership split in one step (save_work in the database). */
export async function saveWork(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let savedId: string;
  try {
    const me = await actor("super_admin", "label_admin");
    const title = str(fd, "title");
    if (!title) return { error: "Enter the song title." };

    const artistIds = fd.getAll("owner_artist").map(String);
    const roles = fd.getAll("owner_role").map(String);
    const shares = fd.getAll("owner_share").map(String);
    const territories = fd.getAll("owner_territory").map(String);
    const owners = artistIds
      .map((artist_id, i) => ({
        artist_id,
        role: roles[i] || "composer_author",
        share_pct: Number(shares[i]),
        territory: (territories[i] || "WORLD").toUpperCase(),
      }))
      .filter((o) => o.artist_id);

    for (const o of owners) {
      if (!(o.share_pct > 0 && o.share_pct <= 100)) return { error: "Every owner needs a share between 0 and 100." };
    }
    const byTerritory = new Map<string, number>();
    owners.forEach((o) => byTerritory.set(o.territory, (byTerritory.get(o.territory) ?? 0) + o.share_pct));
    for (const [t, total] of byTerritory) {
      if (total > 100.0001) return { error: `Shares for ${t === "WORLD" ? "worldwide" : t} add up to ${total}%. The limit is 100%.` };
    }

    const iswc = opt(fd, "iswc")?.toUpperCase() ?? null;
    if (iswc && !/^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(iswc)) return { error: "ISWC should look like T-123.456.789-0." };

    const sb = await createClient();
    const { data, error } = await sb.rpc("save_work", {
      p_work: {
        id,
        title,
        iswc,
        isrc: codes(str(fd, "isrc")),
        language: opt(fd, "language"),
        genre: opt(fd, "genre"),
        release_date: opt(fd, "release_date"),
        territories: codes(str(fd, "territories") || "WORLD"),
        status: str(fd, "status") || "draft",
        notes: opt(fd, "notes"),
        label_id: me.role === "super_admin" ? opt(fd, "label_id") : me.labelId,
      },
      p_owners: owners,
    });
    if (error) return { error: friendly(error.message) };
    savedId = data as string;
  } catch (e) {
    return { error: friendly((e as Error).message) };
  }
  redirect(`/catalog?saved=${savedId}`);
}
