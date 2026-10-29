import Link from "next/link";
import { PageTitle, Panel, StatusChip } from "@/components/ui";
import { getLabelsWithAliases, getReports } from "@/lib/admin-data";
import { isDemo } from "@/lib/data";
import { dateLabel, money } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { publishAllReady } from "./actions";
import { UploadIprs } from "./UploadIprs";

export default async function UploadsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await requireRole("super_admin");
  const { deleted } = await searchParams;
  if (isDemo()) {
    return (
      <div>
        <PageTitle title="Report uploads" />
        <Panel>Connect the database to upload statements.</Panel>
      </div>
    );
  }
  const [reports, labels] = await Promise.all([getReports(), getLabelsWithAliases()]);
  const ready = reports.filter((r) => !r.published_at && r.status === "processed").length;
  const toCheck = reports.filter((r) => !r.published_at && r.status !== "processed").length;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Report uploads"
        intro="Upload IPRS statements. Every line is matched to a work and a client, the commission is applied, and the total is checked against the statement. Clients see the money only after you publish."
      />
      {deleted && (
        <p role="status" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          Report deleted.
        </p>
      )}

      <Panel title="Upload IPRS statements">
        <UploadIprs labels={labels} />
      </Panel>

      <Panel
        title="Uploaded reports"
        note={
          reports.length
            ? `${ready} ready to publish · ${toCheck} need checking · ${reports.length - ready - toCheck} published`
            : undefined
        }
      >
        {ready > 0 && (
          <form action={publishAllReady} className="mb-4">
            <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Publish all {ready} checked {ready === 1 ? "report" : "reports"}
            </button>
            <span className="ml-3 text-sm text-ink-3">Only reports that add up and are fully matched.</span>
          </form>
        )}
        {reports.length === 0 ? (
          <p className="text-ink-3">No statements uploaded yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="px-5 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 text-right font-medium">Lines</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Check</th>
                  <th className="px-5 py-2 font-medium">Clients see it</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2">
                      <Link href={`/uploads/${r.id}`} className="font-semibold text-brand hover:underline">
                        {r.file_name ?? r.source}
                      </Link>
                      <span className="block text-xs text-ink-3">
                        {r.source} · {r.royalty_type === "publisher" ? "Collected by Plutus" : "Paid directly"} · uploaded {dateLabel(r.created_at)}
                      </span>
                    </td>
                    <td className="num px-3 py-2 text-ink-2">{r.distribution_code ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-2">
                      {dateLabel(r.period_start)} – {dateLabel(r.period_end)}
                    </td>
                    <td className="num px-3 py-2 text-right">{r.row_count}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{money(r.total_gross)}</td>
                    <td className="px-3 py-2">
                      {r.status === "processed" ? (
                        <StatusChip status="matched" />
                      ) : (
                        <span className="text-sm font-semibold text-bad">
                          {r.unmatched_count ? `${r.unmatched_count} not matched` : "Total differs"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2">{r.published_at ? <StatusChip status="published" /> : <StatusChip status="hidden" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
