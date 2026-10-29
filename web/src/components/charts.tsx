import { money } from "@/lib/format";
import type { BreakdownRow } from "@/lib/types";

/** Small legend — identity is never colour-alone: every bar also carries text values. */
export function Legend({ showDirect = true }: { showDirect?: boolean }) {
  const items = [
    { cls: "bg-net", label: "Net to rights holder" },
    { cls: "bg-comm", label: "Plutus commission" },
    ...(showDirect ? [{ cls: "bg-direct", label: "Paid directly by society" }] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${i.cls}`} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Horizontal stacked bar per bucket (net | commission | direct), one shared scale,
 * total printed at the end. 2px surface gaps between segments.
 */
export function BarList({
  rows,
  labelFor = (s: string) => s,
}: {
  rows: BreakdownRow[];
  labelFor?: (bucket: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.publisher_gross + r.admin_only));
  if (!rows.length) return <p className="text-sm text-ink-3">No earnings yet.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Earnings breakdown</caption>
      <thead className="sr-only">
        <tr>
          <th>Bucket</th>
          <th>Bar</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const total = r.publisher_gross + r.admin_only;
          const seg = (v: number) => `${(v / max) * 100}%`;
          const tip = `${labelFor(r.bucket)}: net ${money(r.publisher_net)}, commission ${money(r.commission)}, paid directly ${money(r.admin_only)}`;
          return (
            <tr key={r.bucket} title={tip} className="group">
              <th scope="row" className="w-32 py-1.5 pr-3 text-left font-medium text-ink-2 group-hover:text-ink">
                {labelFor(r.bucket)}
              </th>
              <td className="py-1.5">
                <div className="flex h-3.5 gap-[2px]" aria-hidden>
                  {r.publisher_net > 0 && <span className="rounded-l-[3px] bg-net" style={{ width: seg(r.publisher_net) }} />}
                  {r.commission > 0 && <span className="bg-comm" style={{ width: seg(r.commission) }} />}
                  {r.admin_only > 0 && <span className="rounded-r-[3px] bg-direct" style={{ width: seg(r.admin_only) }} />}
                </div>
              </td>
              <td className="num w-28 py-1.5 pl-3 text-right font-semibold">{money(total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Column chart over time — stacked, single axis, totals printed above each column. */
export function PeriodColumns({ rows, labelFor }: { rows: BreakdownRow[]; labelFor: (b: string) => string }) {
  const sorted = [...rows].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const max = Math.max(1, ...sorted.map((r) => r.publisher_gross + r.admin_only));
  if (!sorted.length) return <p className="text-sm text-ink-3">No earnings yet.</p>;
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <div className="flex h-44 items-end gap-3 border-b border-line">
        {sorted.map((r) => {
          const total = r.publisher_gross + r.admin_only;
          return (
            <div
              key={r.bucket}
              className="group flex h-full flex-1 flex-col justify-end"
              title={`${labelFor(r.bucket)}: net ${money(r.publisher_net)}, commission ${money(r.commission)}, paid directly ${money(r.admin_only)}`}
            >
              <span className="num mb-1 text-center text-xs font-semibold text-ink-2 group-hover:text-ink">
                {money(total)}
              </span>
              <div className="flex flex-col-reverse gap-[2px]" style={{ height: h(total) }} aria-hidden>
                <span className="bg-net" style={{ flexGrow: r.publisher_net }} />
                {r.commission > 0 && <span className="bg-comm" style={{ flexGrow: r.commission }} />}
                {r.admin_only > 0 && <span className="rounded-t-[4px] bg-direct" style={{ flexGrow: r.admin_only }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3">
        {sorted.map((r) => (
          <span key={r.bucket} className="flex-1 text-center text-xs text-ink-3">
            {labelFor(r.bucket)}
          </span>
        ))}
      </div>
    </div>
  );
}
