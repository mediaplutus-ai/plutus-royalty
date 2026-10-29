"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import { saveWork } from "./actions";

type Opt = { id: string; name: string };
type Owner = { key: number; artist_id: string; role: string; share_pct: string; territory: string };

export interface WorkFormValues {
  id: string;
  label_id: string | null;
  title: string;
  iswc: string | null;
  isrc: string[];
  language: string | null;
  genre: string | null;
  release_date: string | null;
  territories: string[];
  status: string;
  notes: string | null;
  owners: { artist_id: string; role: string; share_pct: number; territory: string }[];
}

const ROLES = [
  ["composer_author", "Composer & author"],
  ["composer", "Composer"],
  ["author", "Author (lyricist)"],
  ["arranger", "Arranger"],
  ["original_publisher", "Publisher"],
  ["sub_publisher", "Sub-publisher"],
  ["performer", "Performer"],
] as const;

const STATUSES = [
  ["draft", "Draft"],
  ["submitted", "Submitted to society"],
  ["registered", "Registered"],
  ["disputed", "Disputed"],
  ["inactive", "Inactive"],
] as const;

let seq = 0;

export function WorkForm({
  work,
  artists,
  labels,
  isSuper,
}: {
  work?: WorkFormValues;
  artists: Opt[];
  labels: Opt[];
  isSuper: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveWork.bind(null, work?.id ?? null), undefined);
  const [owners, setOwners] = useState<Owner[]>(
    work?.owners.length
      ? work.owners.map((o) => ({ key: seq++, artist_id: o.artist_id, role: o.role, share_pct: String(o.share_pct), territory: o.territory }))
      : [{ key: seq++, artist_id: "", role: "composer_author", share_pct: "100", territory: "WORLD" }],
  );

  const totals = new Map<string, number>();
  owners
    .filter((o) => o.artist_id)
    .forEach((o) => {
      const t = (o.territory || "WORLD").toUpperCase();
      totals.set(t, (totals.get(t) ?? 0) + (Number(o.share_pct) || 0));
    });
  const over = [...totals.values()].some((v) => v > 100.0001);

  const patch = (key: number, p: Partial<Owner>) => setOwners((list) => list.map((o) => (o.key === key ? { ...o, ...p } : o)));

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Song title" htmlFor="w-title" className="md:col-span-2">
          <input id="w-title" name="title" required defaultValue={work?.title} className={inputCls} />
        </Field>
        <Field label="ISWC" htmlFor="w-iswc" hint="From IPRS, e.g. T-123.456.789-0. Leave empty until registered.">
          <input id="w-iswc" name="iswc" defaultValue={work?.iswc ?? ""} className={`${inputCls} num`} />
        </Field>
        <Field label="ISRC codes" htmlFor="w-isrc" hint="One work can have several recordings. Separate with commas.">
          <input id="w-isrc" name="isrc" defaultValue={work?.isrc.join(", ")} className={`${inputCls} num`} />
        </Field>
        <Field label="Language" htmlFor="w-lang">
          <input id="w-lang" name="language" defaultValue={work?.language ?? ""} className={inputCls} placeholder="Hindi" />
        </Field>
        <Field label="Genre" htmlFor="w-genre">
          <input id="w-genre" name="genre" defaultValue={work?.genre ?? ""} className={inputCls} placeholder="Devotional" />
        </Field>
        <Field label="Release date" htmlFor="w-date">
          <input id="w-date" name="release_date" type="date" defaultValue={work?.release_date ?? ""} className={inputCls} />
        </Field>
        <Field label="Status" htmlFor="w-status">
          <select id="w-status" name="status" defaultValue={work?.status ?? "draft"} className={inputCls}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Territories" htmlFor="w-terr" hint="WORLD, or country codes like IN, GB, US">
          <input id="w-terr" name="territories" defaultValue={(work?.territories ?? ["WORLD"]).join(", ")} className={inputCls} />
        </Field>
        {isSuper && (
          <Field label="Label" htmlFor="w-label">
            <select id="w-label" name="label_id" defaultValue={work?.label_id ?? ""} className={inputCls}>
              <option value="">No label (independent)</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notes" htmlFor="w-notes" className="md:col-span-2">
          <textarea id="w-notes" name="notes" rows={2} defaultValue={work?.notes ?? ""} className={inputCls} />
        </Field>
      </div>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-bold">Who owns this work</legend>
        <p className="mb-3 text-sm text-ink-3">
          Shares per territory must add up to 100% or less. Not in the list?{" "}
          <a href="/people?tab=holders" className="font-semibold text-brand hover:underline">
            Add the rights holder
          </a>{" "}
          first.
        </p>
        <div className="space-y-3">
          {owners.map((o, i) => (
            <div key={o.key} className="grid items-end gap-2 sm:grid-cols-[2fr_1.5fr_0.8fr_0.9fr_auto]">
              <Field label={i === 0 ? "Rights holder" : ""} htmlFor={`o-a-${o.key}`}>
                <select
                  id={`o-a-${o.key}`}
                  name="owner_artist"
                  value={o.artist_id}
                  onChange={(e) => patch(o.key, { artist_id: e.target.value })}
                  className={inputCls}
                  aria-label="Rights holder"
                >
                  <option value="">Choose</option>
                  {artists.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={i === 0 ? "Role" : ""} htmlFor={`o-r-${o.key}`}>
                <select id={`o-r-${o.key}`} name="owner_role" value={o.role} onChange={(e) => patch(o.key, { role: e.target.value })} className={inputCls} aria-label="Role">
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={i === 0 ? "Share %" : ""} htmlFor={`o-s-${o.key}`}>
                <input
                  id={`o-s-${o.key}`}
                  name="owner_share"
                  type="number"
                  min="0.001"
                  max="100"
                  step="0.001"
                  value={o.share_pct}
                  onChange={(e) => patch(o.key, { share_pct: e.target.value })}
                  className={`${inputCls} num text-right`}
                  aria-label="Share percent"
                />
              </Field>
              <Field label={i === 0 ? "Territory" : ""} htmlFor={`o-t-${o.key}`}>
                <input
                  id={`o-t-${o.key}`}
                  name="owner_territory"
                  value={o.territory}
                  onChange={(e) => patch(o.key, { territory: e.target.value.toUpperCase() })}
                  className={inputCls}
                  aria-label="Territory"
                />
              </Field>
              <button
                type="button"
                onClick={() => setOwners((l) => l.filter((x) => x.key !== o.key))}
                className="mb-0.5 rounded-md border border-line px-3 py-2 text-sm hover:bg-sunken"
                aria-label="Remove this owner"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOwners((l) => [...l, { key: seq++, artist_id: "", role: "composer_author", share_pct: "", territory: "WORLD" }])}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:bg-sunken"
          >
            + Add owner
          </button>
          <p className={`text-sm font-semibold ${over ? "text-bad" : "text-ink-2"}`} aria-live="polite">
            {[...totals.entries()].map(([t, v]) => `${t === "WORLD" ? "Worldwide" : t}: ${Math.round(v * 1000) / 1000}%`).join(" · ") || "No owners yet"}
            {over && " — over 100%"}
          </p>
        </div>
      </fieldset>

      <FormMessage state={state} />
      <div className="flex gap-3">
        <SubmitButton>{work ? "Save changes" : "Add work"}</SubmitButton>
        <Link href={"/catalog"} className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-sunken">
          Cancel
        </Link>
      </div>
    </form>
  );
}
