"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { inputCls } from "@/components/forms";
import { money } from "@/lib/format";
import { readFirstSheet } from "@/lib/iprs/load";
import { normName, parseIprsRows, type IprsStatement } from "@/lib/iprs/parse";
import { societyCountry } from "@/lib/iprs/societies";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type LabelOpt = { id: string; name: string; aliases: string[] };
type Parsed = { fileName: string; data: ArrayBuffer; sha: string; st: IprsStatement };
type Choice = string; // label id | "new" | "none"
type Result = { fileName: string; ok: boolean; reportId?: string; message: string };

const TOLERANCE = 0.05;

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "BANG MUSIC PVT LTD" -> "Bang Music Pvt Ltd" (LLP stays in capitals) */
const niceName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/\bLlp\b/g, "LLP");

export function UploadIprs({ labels }: { labels: LabelOpt[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<Parsed[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [type, setType] = useState<"publisher" | "admin_only">("publisher");
  const [periodMode, setPeriodMode] = useState<"year" | "custom">("year");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [addWorks, setAddWorks] = useState(true);
  const [results, setResults] = useState<Result[]>([]);

  const labelByNorm = useMemo(() => {
    const m = new Map<string, LabelOpt>();
    labels.forEach((l) => {
      m.set(normName(l.name), l);
      l.aliases.forEach((a) => m.set(normName(a), l));
    });
    return m;
  }, [labels]);

  // every original publisher across the chosen files, with its money
  const publishers = useMemo(() => {
    const m = new Map<string, { name: string; total: number; works: Set<string> }>();
    files.forEach((f) =>
      f.st.lines.forEach((l) => {
        const key = normName(l.publisher) || "(NO PUBLISHER)";
        const p = m.get(key) ?? { name: l.publisher ?? "(no publisher on statement)", total: 0, works: new Set<string>() };
        p.total += l.amount;
        p.works.add(l.workNo);
        m.set(key, p);
      }),
    );
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [files]);

  const choiceFor = (key: string): Choice => choices[key] ?? labelByNorm.get(key)?.id ?? (key === "(NO PUBLISHER)" ? "none" : "new");

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    setResults([]);
    setProblems([]);
    const out: Parsed[] = [];
    const bad: string[] = [];
    const JSZip = (await import("jszip")).default;

    const handleXlsx = async (fileName: string, data: ArrayBuffer) => {
      try {
        setBusy(`Reading ${fileName}`);
        const { sheetName, rows } = await readFirstSheet(data);
        const st = parseIprsRows(rows, fileName, sheetName);
        out.push({ fileName, data, sha: await sha256(data), st });
      } catch (e) {
        bad.push(`${fileName}: ${(e as Error).message}`);
      }
    };

    for (const f of Array.from(list)) {
      const buf = await f.arrayBuffer();
      if (/\.zip$/i.test(f.name)) {
        setBusy(`Opening ${f.name}`);
        const zip = await JSZip.loadAsync(buf);
        const entries = Object.values(zip.files).filter(
          (z) => !z.dir && /\.xlsx$/i.test(z.name) && !z.name.startsWith("__MACOSX") && !/(^|\/)~\$/.test(z.name),
        );
        if (!entries.length) bad.push(`${f.name}: no Excel files inside`);
        for (const z of entries) await handleXlsx(z.name.split("/").pop()!, await z.async("arraybuffer"));
      } else if (/\.xlsx$/i.test(f.name)) {
        await handleXlsx(f.name, buf);
      } else {
        bad.push(`${f.name}: only .xlsx or .zip files are accepted`);
      }
    }
    // same file twice in one selection
    const seen = new Set<string>();
    const unique = out.filter((p) => (seen.has(p.sha) ? (bad.push(`${p.fileName}: same file chosen twice, skipped`), false) : seen.add(p.sha)));
    unique.sort((a, b) => a.fileName.localeCompare(b.fileName));
    setFiles(unique);
    setProblems(bad);
    setBusy(null);
  }

  const totals = files.reduce((t, f) => ({ lines: t.lines + f.st.lines.length, money: t.money + f.st.lineTotal }), { lines: 0, money: 0 });
  const allBalanced = files.every((f) => f.st.footerTotal != null && Math.abs(f.st.lineTotal - f.st.footerTotal) < TOLERANCE);
  const needsYear = periodMode === "year" && files.some((f) => !f.st.year);
  const periodOk = periodMode === "year" ? !needsYear : Boolean(from && to && to >= from);

  async function doImport() {
    const sb = createBrowserSupabase();
    const res: Result[] = [];
    try {
      // 1. create the labels marked "new"
      const created = new Map<string, string>();
      for (const [key, p] of publishers) {
        if (choiceFor(key) !== "new") continue;
        setBusy(`Adding client ${p.name}`);
        const { data, error } = await sb.from("labels").insert({ name: niceName(p.name) }).select("id").single();
        if (error) throw new Error(`Could not add ${p.name}: ${error.message}`);
        created.set(key, data.id);
      }
      const labelIdFor = (key: string) => {
        const c = choiceFor(key);
        return c === "new" ? (created.get(key) ?? null) : c === "none" ? null : c;
      };

      // 2. each file: keep the original, then import in one database call
      for (const [i, f] of files.entries()) {
        setBusy(`Importing ${i + 1} of ${files.length}: ${f.fileName}`);
        const year = f.st.year;
        const path = `${year ?? "unknown"}/${f.sha}.xlsx`;
        await sb.storage
          .from("royalty-reports")
          .upload(path, f.data, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

        const fileClients = [...new Set(f.st.lines.map((l) => normName(l.publisher)))]
          .map((key) => ({ name: publishers.find(([k]) => k === key)?.[1].name ?? key, label_id: labelIdFor(key) }))
          .filter((c) => c.label_id);
        const country = societyCountry(f.st.foreignSociety);

        const meta = {
          file_name: f.fileName,
          file_path: path,
          file_sha256: f.sha,
          period_start: periodMode === "year" ? `${year}-01-01` : from,
          period_end: periodMode === "year" ? `${year}-12-31` : to,
          royalty_type: type,
          declared_total: f.st.footerTotal,
          distribution_code: f.st.distributionCode,
          source: "IPRS",
          territory: f.st.foreignSociety ? (country ?? "XX") : "IN",
          create_missing_works: addWorks,
          clients: fileClients,
          notes: f.st.foreignSociety ? `Foreign society: ${f.st.foreignSociety}` : null,
        };
        const lines = f.st.lines.map((l) => ({
          workNo: l.workNo,
          title: l.title,
          language: l.language,
          publisher: l.publisher,
          licensee: l.licensee,
          pool: l.pool,
          amount: l.amount,
          collPct: l.collPct,
          ...(l.breakdown ? { breakdown: l.breakdown } : {}),
        }));
        const { data, error } = await sb.rpc("import_iprs_report", { p_meta: meta, p_lines: lines });
        res.push(
          error
            ? { fileName: f.fileName, ok: false, message: error.message.replace(/^.*?ERROR:\s*/i, "") }
            : { fileName: f.fileName, ok: true, reportId: data as string, message: `${f.st.lines.length} lines, ${money(f.st.lineTotal)}` },
        );
      }
    } catch (e) {
      res.push({ fileName: "—", ok: false, message: (e as Error).message });
    }
    setResults(res);
    setFiles([]);
    setChoices({});
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="iprs-files" className="mb-1 block text-sm font-medium">
          IPRS statement files
        </label>
        <input
          id="iprs-files"
          type="file"
          multiple
          accept=".xlsx,.zip"
          disabled={Boolean(busy)}
          onChange={(e) => onPick(e.target.files)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold"
        />
        <p className="mt-1 text-xs text-ink-3">Choose one or many .xlsx files, or the .zip exactly as IPRS sent it. Nothing is saved until you press Import.</p>
      </div>

      {busy && (
        <p className="text-sm text-ink-2" aria-live="polite">
          {busy}…
        </p>
      )}
      {problems.length > 0 && (
        <ul className="rounded-md border border-bad/40 bg-sunken px-3 py-2 text-sm text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {results.length > 0 && (
        <div className="rounded-md border border-line bg-sunken p-3 text-sm">
          <p className="mb-2 font-semibold">
            Import finished: {results.filter((r) => r.ok).length} of {results.length} files saved. They are hidden from clients until you publish them below.
          </p>
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? "text-ink-2" : "text-bad"}>
                {r.ok ? "✓" : "×"} {r.fileName}: {r.message}
                {r.reportId && (
                  <Link href={`/uploads/${r.reportId}`} className="ml-2 font-semibold text-brand hover:underline">
                    Check
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {files.length > 0 && (
        <>
          <section>
            <h3 className="mb-2 text-sm font-bold">
              1. Files ({files.length}) · {totals.lines} royalty lines · {money(totals.money)}
            </h3>
            <div className="max-h-72 overflow-auto rounded-md border border-line">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="px-3 py-2 font-medium">File</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 text-right font-medium">Works</th>
                    <th className="px-3 py-2 text-right font-medium">Lines</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Adds up?</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const ok = f.st.footerTotal != null && Math.abs(f.st.lineTotal - f.st.footerTotal) < TOLERANCE;
                    return (
                      <tr key={f.sha} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5">
                          {f.fileName}
                          {f.st.foreignSociety && <span className="ml-1 text-xs text-ink-3">({f.st.foreignSociety})</span>}
                        </td>
                        <td className="num px-3 py-1.5 text-ink-2">{f.st.distributionCode ?? "—"}</td>
                        <td className="num px-3 py-1.5 text-right">{f.st.works}</td>
                        <td className="num px-3 py-1.5 text-right">{f.st.lines.length}</td>
                        <td className="num px-3 py-1.5 text-right font-semibold">{money(f.st.lineTotal)}</td>
                        <td className={`px-3 py-1.5 ${ok ? "text-ok" : "text-bad"}`}>
                          {ok ? "✓ matches statement total" : `× statement says ${money(f.st.footerTotal)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!allBalanced && <p className="mt-2 text-sm text-bad">Some files do not add up to their own total. You can still import; they will be marked for checking.</p>}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold">2. Clients (original publishers on the statements)</h3>
            <p className="mb-2 text-sm text-ink-3">
              Each line belongs to the publisher Plutus represents on that work. Matching is remembered for next time.
            </p>
            <div className="max-h-80 overflow-auto rounded-md border border-line">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="px-3 py-2 font-medium">Name on statement</th>
                    <th className="px-3 py-2 text-right font-medium">Works</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Client in Plutus</th>
                  </tr>
                </thead>
                <tbody>
                  {publishers.map(([key, p]) => (
                    <tr key={key} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5 font-semibold">{p.name}</td>
                      <td className="num px-3 py-1.5 text-right">{p.works.size}</td>
                      <td className="num px-3 py-1.5 text-right">{money(p.total)}</td>
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={`Client for ${p.name}`}
                          value={choiceFor(key)}
                          onChange={(e) => setChoices((c) => ({ ...c, [key]: e.target.value }))}
                          className={`${inputCls} py-1 text-sm`}
                        >
                          <option value="new">+ Add as new client “{niceName(p.name)}”</option>
                          <option value="none">Leave unassigned (check later)</option>
                          {labels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-bold">3. How was this money paid?</h3>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="rtype" checked={type === "publisher"} onChange={() => setType("publisher")} className="mt-1" />
                <span>
                  <span className="font-semibold">Collected by Plutus</span> (sub-publisher): Plutus keeps its commission and pays the rest to the client.
                </span>
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="radio" name="rtype" checked={type === "admin_only"} onChange={() => setType("admin_only")} className="mt-1" />
                <span>
                  <span className="font-semibold">Paid directly</span> to the client by IPRS: Plutus records it and invoices its commission.
                </span>
              </label>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={addWorks} onChange={(e) => setAddWorks(e.target.checked)} />
                Add works that are not in the catalog yet (with their IPRS work number)
              </label>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold">4. Period</h3>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="pmode" checked={periodMode === "year"} onChange={() => setPeriodMode("year")} className="mt-1" />
                <span>Use the year in each file name (P25… = 2025)</span>
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="radio" name="pmode" checked={periodMode === "custom"} onChange={() => setPeriodMode("custom")} className="mt-1" />
                <span>Same period for all files</span>
              </label>
              {periodMode === "custom" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input type="date" aria-label="Period from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
                  <input type="date" aria-label="Period to" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
                </div>
              )}
              {needsYear && <p className="mt-2 text-sm text-bad">Some file names have no year. Choose “Same period for all files”.</p>}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={Boolean(busy) || !periodOk}
              onClick={doImport}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Import {files.length} {files.length === 1 ? "file" : "files"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setFiles([])} className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-sunken">
              Cancel
            </button>
            <p className="text-sm text-ink-3">Clients see nothing until you publish each report.</p>
          </div>
        </>
      )}
    </div>
  );
}
