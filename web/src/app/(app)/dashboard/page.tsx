import Link from "next/link";
import { BarList, Legend, PeriodColumns } from "@/components/charts";
import { Panel, StatusChip, TypeTag } from "@/components/ui";
import { getBreakdown, getKpis, getRoyaltyLines, getViewer } from "@/lib/data";
import { money, periodLabel, territoryName } from "@/lib/format";
import type { Kpis, Viewer } from "@/lib/types";

export default async function DashboardPage() {
  const [viewer, k, bySource, byTerritory, byMonth, latest] = await Promise.all([
    getViewer(),
    getKpis(),
    getBreakdown("source"),
    getBreakdown("territory"),
    getBreakdown("month"),
    getRoyaltyLines(undefined, 6),
  ]);

  const monthLabel = (b: string) => periodLabel(`${b}-01`);

  return (
    <div className="space-y-6">
      <MoneyFlow k={k} viewer={viewer} />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        <Figure label="Lifetime earnings" value={money(k.lifetime_net)} note={`+ ${money(k.admin_only_lifetime)} paid directly`} />
        <Figure
          label="Current period"
          value={money(k.current_period_net)}
          note={periodLabel(k.current_period_start, k.current_period_end)}
        />
        <Figure label="Pending royalties" value={money(k.pending_net)} note="Collected, not yet paid out" />
        <Figure label="Paid royalties" value={money(k.paid_net)} note="Settled by Plutus" />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Earnings by source" note="Societies and platforms, all periods">
          <BarList rows={bySource} />
        </Panel>
        <Panel title="Earnings by territory" note="Where the music was used">
          <BarList rows={byTerritory} labelFor={(t) => territoryName[t] ?? t} />
        </Panel>
      </div>

      <Panel title="Earnings per period" note="Each column is one statement period">
        <PeriodColumns rows={byMonth} labelFor={monthLabel} />
        <div className="mt-4">
          <Legend />
        </div>
      </Panel>

      <Panel title="Latest royalty lines">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-5 py-2 font-medium">Work</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Net payable</th>
                <th className="px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 font-medium">{l.work_title ?? <span className="text-bad">Not matched</span>}</td>
                  <td className="px-3 py-2.5">
                    {l.source} <span className="text-ink-3">({l.territory})</span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{periodLabel(l.period_start, l.period_end)}</td>
                  <td className="px-3 py-2.5">
                    <TypeTag type={l.royalty_type} />
                  </td>
                  <td className="num px-3 py-2.5 text-right font-semibold">{money(l.net_payable)}</td>
                  <td className="px-5 py-2.5">
                    <StatusChip status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/royalties" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
          See all royalty lines
        </Link>
      </Panel>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tracking-tight">{value}</dd>
      <dd className="mt-0.5 text-xs text-ink-3">{note}</dd>
    </div>
  );
}

/**
 * The transparency statement: in plain words and one shared rupee scale,
 * what was collected, what Plutus kept, what reached the rights holder,
 * and what the societies paid directly.
 */
function MoneyFlow({ k, viewer }: { k: Kpis; viewer: Viewer }) {
  const who =
    viewer.role === "author_composer" ? "you" : viewer.role === "label_admin" ? "your artists" : "rights holders";
  const whose = viewer.role === "author_composer" ? "yours" : viewer.role === "label_admin" ? "your artists'" : "theirs";
  const total = k.lifetime_gross + k.admin_only_lifetime;
  const pct = (v: number) => (total > 0 ? `${(v / total) * 100}%` : "0%");
  const effective = k.lifetime_gross > 0 ? (k.lifetime_commission / k.lifetime_gross) * 100 : 0;

  if (total === 0) {
    return (
      <section className="rounded-lg border border-line bg-surface p-6">
        <h1 className="text-[1.9rem] font-extrabold tracking-tight">No royalties yet</h1>
        <p className="mt-2 max-w-xl text-ink-2">
          As soon as a society or platform statement is uploaded, this page shows exactly where the money came from,
          what Plutus kept, and what is {whose}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6 md:p-7">
      <h1 className="max-w-3xl text-[1.6rem] font-extrabold leading-snug tracking-tight md:text-[1.95rem]">
        Plutus collected <span>{money(k.lifetime_gross)}</span> for {who}, kept{" "}
        <span>{money(k.lifetime_commission)}</span> as commission, and{" "}
        <span>{money(k.lifetime_net)}</span> is {whose}.
      </h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Societies also paid <span className="font-semibold text-ink">{money(k.admin_only_lifetime)}</span> straight
        to {who === "you" ? "you" : "the rights holders"}. Plutus only tracks that money and takes no commission on it.
      </p>

      <div className="mt-6" role="img" aria-label={`Of ${money(total)} earned: ${money(k.lifetime_net)} net, ${money(k.lifetime_commission)} Plutus commission, ${money(k.admin_only_lifetime)} paid directly`}>
        <div className="flex h-7 gap-[2px]">
          <span className="rounded-l-[4px] bg-net" style={{ width: pct(k.lifetime_net) }} />
          <span className="bg-comm" style={{ width: pct(k.lifetime_commission) }} />
          <span className="rounded-r-[4px] bg-direct" style={{ width: pct(k.admin_only_lifetime) }} />
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <FlowLabel cls="bg-net" title={`Net to ${who}`} value={money(k.lifetime_net)} />
          <FlowLabel cls="bg-comm" title={`Plutus commission (${effective.toFixed(1)}% average)`} value={money(k.lifetime_commission)} />
          <FlowLabel cls="bg-direct" title="Paid directly by societies" value={money(k.admin_only_lifetime)} />
        </div>
      </div>
    </section>
  );
}

function FlowLabel({ cls, title, value }: { cls: string; title: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1 h-3 w-3 shrink-0 rounded-sm ${cls}`} aria-hidden />
      <div>
        <p className="text-ink-2">{title}</p>
        <p className="font-bold">{value}</p>
      </div>
    </div>
  );
}
