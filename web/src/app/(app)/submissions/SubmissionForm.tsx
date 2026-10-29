"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { saveSubmission } from "./actions";

type WriterRow = { key: number; name: string; ipi: string; role: string; share_pct: string; artist_id: string };

export interface SubmissionValues {
  id: string;
  title: string;
  language: string | null;
  release_date: string | null;
  isrc: string[];
  notes: string | null;
  writers: { name: string; ipi?: string; role: string; share_pct: number; artist_id?: string }[];
  files: { path: string; name: string }[];
}

const MAX_MB = 50;
let seq = 0;

function safeName(n: string) {
  return n.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
}

export function SubmissionForm({
  userId,
  submission,
  me,
}: {
  userId: string;
  submission?: SubmissionValues;
  me?: { name: string; ipi: string | null; artist_id: string } | null;
}) {
  const [writers, setWriters] = useState<WriterRow[]>(
    submission?.writers.length
      ? submission.writers.map((w) => ({
          key: seq++,
          name: w.name,
          ipi: w.ipi ?? "",
          role: w.role,
          share_pct: String(w.share_pct),
          artist_id: w.artist_id ?? "",
        }))
      : [
          {
            key: seq++,
            name: me?.name ?? "",
            ipi: me?.ipi ?? "",
            role: "composer_author",
            share_pct: "100",
            artist_id: me?.artist_id ?? "",
          },
        ],
  );
  const [kept, setKept] = useState(submission?.files ?? []);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Upload chosen files straight to private storage first, then save the form.
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const chosen = (fd.getAll("upload") as File[]).filter((f) => f && f.size > 0);
    fd.delete("upload");
    const tooBig = chosen.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) return { error: `${tooBig.name} is larger than ${MAX_MB} MB. Send a smaller file or a link in the notes.` };
    if (chosen.length) {
      const sb = createBrowserSupabase();
      const batch = `${Date.now()}`;
      for (const [i, f] of chosen.entries()) {
        setProgress(`Uploading ${i + 1} of ${chosen.length}: ${f.name}`);
        const path = `${userId}/${batch}/${i}-${safeName(f.name)}`;
        const { error } = await sb.storage.from("work-submissions").upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (error) {
          setProgress(null);
          return { error: `Could not upload ${f.name}: ${error.message}` };
        }
        fd.append("file_path", path);
      }
      setProgress(null);
    }
    return saveSubmission(submission?.id ?? null, prev, fd);
  }, undefined);

  const total = writers.reduce((t, w) => t + (Number(w.share_pct) || 0), 0);
  const patch = (key: number, p: Partial<WriterRow>) => setWriters((l) => l.map((w) => (w.key === key ? { ...w, ...p } : w)));

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Song title" htmlFor="s-title" className="md:col-span-2">
          <input id="s-title" name="title" required defaultValue={submission?.title} className={inputCls} />
        </Field>
        <Field label="Language" htmlFor="s-lang">
          <input id="s-lang" name="language" defaultValue={submission?.language ?? ""} className={inputCls} placeholder="Hindi" />
        </Field>
        <Field label="Release date" htmlFor="s-date" hint="Planned or actual">
          <input id="s-date" name="release_date" type="date" defaultValue={submission?.release_date ?? ""} className={inputCls} />
        </Field>
        <Field label="ISRC" htmlFor="s-isrc" hint="If the recording already has one. Separate several with commas.">
          <input id="s-isrc" name="isrc" defaultValue={submission?.isrc.join(", ")} className={`${inputCls} num`} />
        </Field>
        <Field label="Notes for Plutus" htmlFor="s-notes" className="md:col-span-2">
          <textarea id="s-notes" name="notes" rows={3} defaultValue={submission?.notes ?? ""} className={inputCls} placeholder="Album, film, YouTube link, anything that helps registration" />
        </Field>
      </div>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-bold">Writers and composers</legend>
        <p className="mb-3 text-sm text-ink-3">Everyone who wrote the lyrics or music, with their IPI number and share. Shares add up to 100% or less.</p>
        <div className="space-y-3">
          {writers.map((w, i) => (
            <div key={w.key} className="grid items-end gap-2 sm:grid-cols-[1.6fr_1fr_1.3fr_0.7fr_auto]">
              <input type="hidden" name="writer_artist" value={w.artist_id} />
              <Field label={i === 0 ? "Name" : ""} htmlFor={`wn-${w.key}`}>
                <input
                  id={`wn-${w.key}`}
                  name="writer_name"
                  value={w.name}
                  onChange={(e) => patch(w.key, { name: e.target.value, artist_id: "" })}
                  className={inputCls}
                  aria-label="Writer name"
                  required={i === 0}
                />
              </Field>
              <Field label={i === 0 ? "IPI" : ""} htmlFor={`wi-${w.key}`}>
                <input id={`wi-${w.key}`} name="writer_ipi" value={w.ipi} onChange={(e) => patch(w.key, { ipi: e.target.value })} className={`${inputCls} num`} aria-label="IPI number" />
              </Field>
              <Field label={i === 0 ? "Role" : ""} htmlFor={`wr-${w.key}`}>
                <select id={`wr-${w.key}`} name="writer_role" value={w.role} onChange={(e) => patch(w.key, { role: e.target.value })} className={inputCls} aria-label="Role">
                  <option value="composer_author">Lyrics & music</option>
                  <option value="author">Lyrics (author)</option>
                  <option value="composer">Music (composer)</option>
                </select>
              </Field>
              <Field label={i === 0 ? "Share %" : ""} htmlFor={`ws-${w.key}`}>
                <input
                  id={`ws-${w.key}`}
                  name="writer_share"
                  type="number"
                  min="0.001"
                  max="100"
                  step="0.001"
                  value={w.share_pct}
                  onChange={(e) => patch(w.key, { share_pct: e.target.value })}
                  className={`${inputCls} num text-right`}
                  aria-label="Share percent"
                  required
                />
              </Field>
              <button
                type="button"
                disabled={writers.length === 1}
                onClick={() => setWriters((l) => l.filter((x) => x.key !== w.key))}
                className="mb-0.5 rounded-md border border-line px-3 py-2 text-sm hover:bg-sunken disabled:opacity-40"
                aria-label="Remove this writer"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setWriters((l) => [...l, { key: seq++, name: "", ipi: "", role: "author", share_pct: "", artist_id: "" }])}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:bg-sunken"
          >
            + Add writer
          </button>
          <p className={`text-sm font-semibold ${total > 100.0001 ? "text-bad" : "text-ink-2"}`} aria-live="polite">
            Total {Math.round(total * 1000) / 1000}%{total > 100.0001 && " — over 100%"}
          </p>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-bold">Files</legend>
        <p className="mb-3 text-sm text-ink-3">Lyrics, audio, agreement or cue sheet. Up to {MAX_MB} MB each. Only you and Plutus can open them.</p>
        {kept.length > 0 && (
          <ul className="mb-3 space-y-1">
            {kept.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-3 rounded-md bg-sunken px-3 py-1.5 text-sm">
                <input type="hidden" name="keep_file" value={f.path} />
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setKept((l) => l.filter((x) => x.path !== f.path))} className="text-bad hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <input ref={fileInput} name="upload" type="file" multiple className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold" />
      </fieldset>

      {progress && (
        <p className="text-sm text-ink-2" aria-live="polite">
          {progress}
        </p>
      )}
      <FormMessage state={state} />
      <div className="flex gap-3">
        <SubmitButton pendingText={progress ? "Uploading" : "Sending"}>{submission ? "Save and re-submit" : "Submit for registration"}</SubmitButton>
        <Link href={submission ? `/submissions/${submission.id}` : "/submissions"} className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-sunken">
          Cancel
        </Link>
      </div>
    </form>
  );
}
