import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Panel, StatusChip } from "@/components/ui";
import { getReport, getReportLines, reportFileLink } from "@/lib/admin-data";
import { dateLabel, money } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { deleteReport, publishReport, unpublishReport } from "../actions";

type SP = Promise<{ published?: string; hidden?: string; error?: string }>;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireRole("super_admin");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const report = await getReport(id);
  if (!report) notFound();
  const [lines, fileUrl] = await Promise.all([getReportLines(id), reportFileLink(report.file_path)]);

  const byClient = new Map<string, { gross: number; comm: number; net: number; lines: number; pct: Set<number> }>();
  for (const l of lines) {
    const k = l.label_name ?? l.artist_name ?? "Not assigned";
    const c = byClient.get(k) ?? { gross: 0, comm: 0, net: 0, lines: 0, pct: new Set<number>() };
    c.gross += l.gross_amount;
    c.comm += l.commission_amount;
    c.net += l.net_payable;
    c.lines++;
    c.pct.add(l.commission_pct);
    byClient.set(k, c);
  }
  const clients = [...byClient.entries()].sort((a, b) => b[1].gross - a[1].gross);
  const total = lines.reduce((t, l) => ({ gross: t.gross + l.gross_amount, comm: t.comm + l.commission_amount, net: t.net + l.net_payable }), { gross: 0, comm: 0, net: 0 });
  const unmatched = lines.filter((l) => l.match_status === "unmatched");
  const isDirect = report.royalty_type === "admin_only";
  const diff = report.declared_total != null ? report.total_gross - report.declared_total : 0;

  return (
    <div className="space-y-6">
      <Link href="/uploads" className="text-sm font-semibold text-brand hover:underline">
        ← Report uploads
      </Link>
      <PageTitle
        title={report.file_name ?? `${report.source} report`}
        intro={`${report.source}${report.distribution_code ? ` ${report.distribution_code}` : ""} · ${dateLabel(report.period_start)} – ${dateLabel(report.period_end)} · ${isDirect ? "Paid directly to clients (Plutus invoices its commission)" : "Collected by Plutus"}`}
      />

      {sp.error && (
        <p role="alert" className="rounded-md border border-bad/40 bg-surface px-3 py-2 text-sm text-bad">
          {sp.error}
        </p>
      )}
      {sp.published && (
        <p role="status" className="rounded-md border border-ok/40 bg-surface px-3 py-2 text-sm text-ok">
          Published. Clients can now see these royalties and were notified.
        </p>
      )}
      {sp.hidden && (
        <p role="status" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          Hidden from clients again.
        </p>
      )}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-sm">
            <p>
              Clients see it: {report.published_at ? <StatusChip status="published" /> : <StatusChip status="hidden" />}
            </p>
            <p>
              Statement total {money(report.declared_total)} · imported {money(report.total_gross)}{" "}
              {Math.abs(diff) <= 1 ? <span className="font-semibold text-ok">✓ adds up</span> : <span className="font-semibold text-bad">× differs by {money(diff)}</span>}
            </p>
            <p>
              {report.row_count} lines · {unmatched.length ? <span className="font-semibold text-bad">{unmatched.length} not matched to a work and client</span> : <span className="text-ok">all matched</span>}
            </p>
            {fileUrl && (
              <p>
                <a href={fileUrl} className="font-semibold text-brand hover:underline">
                  Download the original file
                </a>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {report.published_at ? (
              <form action={unpublishReport.bind(null, report.id)}>
                <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-sunken">Hide from clients</button>
              </form>
            ) : (
              <>
                <form action={publishReport.bind(null, report.id)}>
                  <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                    {unmatched.length ? "Publish anyway" : "Publish to clients"}
                  </button>
                </form>
                <form action={deleteReport.bind(null, report.id)}>
                  <button className="rounded-md border border-bad/50 px-4 py-2 text-sm font-semibold text-bad hover:bg-sunken">Delete report</button>
                </form>
              </>
            )}
          </div>
        </div>
        {unmatched.length > 0 && !report.published_at && (
          <p className="mt-3 text-sm text-ink-3">
            Lines without a client are not shown to anyone except Plutus. Assign the client on the statement name (People &amp; access → Labels) or add the
            work to the catalog, then delete and re-import this file.
          </p>
        )}
      </Panel>

      <Panel title="By client" note={isDirect ? "Royalties the clients already received, and Plutus's commission to invoice" : "What Plutus keeps and what each client gets"}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-3 py-2 text-right font-medium">Lines</th>
                <th className="px-3 py-2 text-right font-medium">Royalty</th>
                <th className="px-3 py-2 text-right font-medium">Commission %</th>
                <th className="px-3 py-2 text-right font-medium">{isDirect ? "Plutus fee to invoice" : "Plutus commission"}</th>
                {!isDirect && <th className="px-5 py-2 text-right font-medium">Pay to client</th>}
              </tr>
            </thead>
            <tbody>
              {clients.map(([name, c]) => (
                <tr key={name} className="border-b border-line">
                  <td className={`px-5 py-2 font-semibold ${name === "Not assigned" ? "text-bad" : ""}`}>{name}</td>
                  <td className="num px-3 py-2 text-right">{c.lines}</td>
                  <td className="num px-3 py-2 text-right">{money(c.gross)}</td>
                  <td className="num px-3 py-2 text-right text-ink-2">{[...c.pct].map((p) => `${p}%`).join(", ")}</td>
                  <td className="num px-3 py-2 text-right">{money(c.comm)}</td>
                  {!isDirect && <td className="num px-5 py-2 text-right font-semibold">{money(c.net)}</td>}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-5 py-2">Total</td>
                <td className="num px-3 py-2 text-right">{lines.length}</td>
                <td className="num px-3 py-2 text-right">{money(total.gross)}</td>
                <td />
                <td className="num px-3 py-2 text-right">{money(total.comm)}</td>
                {!isDirect && <td className="num px-5 py-2 text-right">{money(total.net)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Commission comes from each client&apos;s contract, otherwise the default. Change it at the top of the{" "}
          <Link href="/dashboard" className="font-semibold text-brand hover:underline">
            Overview
          </Link>{" "}
          page; open lines are re-calculated at once.
        </p>
      </Panel>

      {unmatched.length > 0 && (
        <Panel title="Not matched" note="These lines have no work or no client yet">
          <ul className="divide-y divide-line text-sm">
            {unmatched.slice(0, 200).map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{l.work_title}</span>
                  <span className="ml-2 text-ink-3">
                    IPRS {l.raw_work_no} · {l.publisher_name ?? "no publisher"} · {l.licensee}
                  </span>
                </span>
                <span className="num">{money(l.gross_amount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
