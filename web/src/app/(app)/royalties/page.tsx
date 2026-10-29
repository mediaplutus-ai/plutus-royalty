import Link from "next/link";
import { PageTitle, StatusChip } from "@/components/ui";
import { getRoyaltyLines, getViewer } from "@/lib/data";
import { money, periodLabel, territoryName } from "@/lib/format";
import type { RoyaltyType } from "@/lib/types";

export default async function RoyaltiesPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type: t } = await searchParams;
  const type: RoyaltyType = t === "admin_only" ? "admin_only" : "publisher";
  const [viewer, lines] = await Promise.all([getViewer(), getRoyaltyLines(type, 500)]);
  const showArtist = viewer.role !== "author_composer";

  const totals = lines.reduce(
    (a, l) => ({ gross: a.gross + l.gross_amount, comm: a.comm + l.commission_amount, net: a.net + l.net_payable }),
    { gross: 0, comm: 0, net: 0 },
  );

  const tabs: { key: RoyaltyType; label: string; text: string }[] = [
    {
      key: "publisher",
      label: "Collected by Plutus",
      text: "The society or platform paid Plutus. Plutus deducts the commission in the contract and pays the rest.",
    },
    {
      key: "admin_only",
      label: "Paid directly",
      text: "The society paid the rights holder directly. Plutus only keeps track of it, so there is no commission.",
    },
  ];
  const active = tabs.find((x) => x.key === type)!;

  return (
    <div>
      <PageTitle title="Royalties" intro="Every earning line, with its source, territory, period and where the money stands." />

      <div role="tablist" aria-label="Royalty type" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={tab.key === type}
            href={`/royalties?type=${tab.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
              tab.key === type ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <p className="mb-5 max-w-2xl text-sm text-ink-2">{active.text}</p>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">Work</th>
              {showArtist && <th className="px-3 py-2.5 font-medium">Rights holder</th>}
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">Territory</th>
              <th className="px-3 py-2.5 font-medium">Period</th>
              <th className="px-3 py-2.5 text-right font-medium">Gross</th>
              {type === "publisher" && (
                <>
                  <th className="px-3 py-2.5 text-right font-medium">Commission</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net payable</th>
                </>
              )}
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-3">
                  No {active.label.toLowerCase()} royalties yet. They appear here as soon as a statement is uploaded.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 hover:bg-sunken">
                <td className="px-4 py-2.5 font-medium">
                  {l.work_title ?? <StatusChip status="unmatched" />}
                </td>
                {showArtist && <td className="px-3 py-2.5">{l.artist_name ?? "—"}</td>}
                <td className="px-3 py-2.5">
                  {l.source}
                  {l.usage_type && <span className="block text-xs text-ink-3">{l.usage_type}</span>}
                </td>
                <td className="px-3 py-2.5">{territoryName[l.territory] ?? l.territory}</td>
                <td className="px-3 py-2.5 text-ink-2">{periodLabel(l.period_start, l.period_end)}</td>
                <td className="num px-3 py-2.5 text-right">{money(l.gross_amount)}</td>
                {type === "publisher" && (
                  <>
                    <td className="num px-3 py-2.5 text-right text-ink-2">
                      {money(l.commission_amount)}
                      <span className="block text-xs text-ink-3">{Number(l.commission_pct)}%</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold">{money(l.net_payable)}</td>
                  </>
                )}
                <td className="px-4 py-2.5">
                  <StatusChip status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-sunken font-semibold">
                <td className="px-4 py-2.5" colSpan={showArtist ? 5 : 4}>
                  Total, {lines.length} lines
                </td>
                <td className="num px-3 py-2.5 text-right">{money(totals.gross)}</td>
                {type === "publisher" && (
                  <>
                    <td className="num px-3 py-2.5 text-right">{money(totals.comm)}</td>
                    <td className="num px-3 py-2.5 text-right">{money(totals.net)}</td>
                  </>
                )}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
