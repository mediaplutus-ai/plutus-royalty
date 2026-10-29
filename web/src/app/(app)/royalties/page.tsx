import Link from "next/link";
import { inputCls } from "@/components/styles";
import { PageTitle, StatusChip } from "@/components/ui";
import { getFilterOptions, getFilteredLines, getViewer } from "@/lib/data";
import { money, periodLabel, territoryName } from "@/lib/format";
import type { RoyaltyFilters, RoyaltyType } from "@/lib/types";

type SP = Promise<RoyaltyFilters & { type?: string }>;

const STATUS_OPTIONS: [string, string][] = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["on_hold", "On hold"],
  ["disputed", "Disputed"],
  ["paid", "Paid"],
  ["paid_directly", "Paid directly"],
];

export default async function RoyaltiesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const type: RoyaltyType = sp.type === "admin_only" ? "admin_only" : "publisher";
  const filters: RoyaltyFilters = {
    q: sp.q?.trim() || undefined,
    licensee: sp.licensee || undefined,
    territory: sp.territory || undefined,
    client: sp.client || undefined,
    year: sp.year || undefined,
    status: sp.status || undefined,
  };
  const [viewer, lines, options] = await Promise.all([getViewer(), getFilteredLines(type, filters), getFilterOptions()]);
  const showClient = viewer.role !== "author_composer";
  const isDirect = type === "admin_only";
  const anyFilter = Object.values(filters).some(Boolean);

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
      text: "The society paid the rights holder directly. The money is already with them; Plutus records it and invoices its commission separately.",
    },
  ];
  const active = tabs.find((x) => x.key === type)!;
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    Object.entries({ ...filters, type, ...extra }).forEach(([k, v]) => v && p.set(k, String(v)));
    return `/royalties?${p.toString()}`;
  };

  return (
    <div>
      <PageTitle title="Royalties" intro="Every earning line, with its source, territory, period and where the money stands." />

      <div role="tablist" aria-label="Royalty type" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={tab.key === type}
            href={keep({ type: tab.key, status: "" })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
              tab.key === type ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-2">{active.text}</p>

      <form method="get" className="mb-5 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-7">
        <input type="hidden" name="type" value={type} />
        <label className="sr-only" htmlFor="f-q">
          Song
        </label>
        <input id="f-q" name="q" defaultValue={filters.q} placeholder="Song title" className={`${inputCls} py-1.5 text-sm lg:col-span-2`} />
        <Select name="year" label="Year" value={filters.year} options={options.years.map((y) => [y, y])} all="All years" />
        <Select name="licensee" label="Source" value={filters.licensee} options={options.licensees.map((v) => [v, v])} all="All sources" />
        <Select
          name="territory"
          label="Territory"
          value={filters.territory}
          options={options.territories.map((t) => [t, territoryName[t] ?? t])}
          all="All territories"
        />
        {showClient && <Select name="client" label="Client" value={filters.client} options={options.clients.map((v) => [v, v])} all="All clients" />}
        <Select name="status" label="Status" value={filters.status} options={STATUS_OPTIONS} all="Any status" />
        <div className="flex gap-2 sm:col-span-3 lg:col-span-7">
          <button className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">Filter</button>
          {anyFilter && (
            <Link href={`/royalties?type=${type}`} className="rounded-md border border-line px-4 py-1.5 text-sm font-semibold hover:bg-sunken">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">Work</th>
              {showClient && <th className="px-3 py-2.5 font-medium">Client</th>}
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">Territory</th>
              <th className="px-3 py-2.5 font-medium">Period</th>
              <th className="px-3 py-2.5 text-right font-medium">{isDirect ? "Received directly" : "Gross"}</th>
              <th className="px-3 py-2.5 text-right font-medium">{isDirect ? "Plutus commission" : "Commission"}</th>
              {!isDirect && <th className="px-3 py-2.5 text-right font-medium">Net payable</th>}
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-3">
                  {anyFilter
                    ? "Nothing matches these filters."
                    : `No ${active.label.toLowerCase()} royalties yet. They appear here as soon as a statement is published.`}
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 hover:bg-sunken">
                <td className="px-4 py-2.5 font-medium">{l.work_title ?? <StatusChip status="unmatched" />}</td>
                {showClient && <td className="px-3 py-2.5">{l.label_name ?? l.artist_name ?? "—"}</td>}
                <td className="px-3 py-2.5">
                  {l.licensee ?? l.source}
                  <span className="block text-xs text-ink-3">
                    {l.source}
                    {l.usage_type ? ` · ${l.usage_type}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2.5">{territoryName[l.territory] ?? l.territory}</td>
                <td className="px-3 py-2.5 text-ink-2">
                  {periodLabel(l.period_start, l.period_end)}
                  {l.distribution_code && <span className="num block text-xs text-ink-3">{l.distribution_code}</span>}
                </td>
                <td className="num px-3 py-2.5 text-right">{money(l.gross_amount)}</td>
                <td className="num px-3 py-2.5 text-right text-ink-2">
                  {money(l.commission_amount)}
                  <span className="block text-xs text-ink-3">{Number(l.commission_pct)}%</span>
                </td>
                {!isDirect && <td className="num px-3 py-2.5 text-right font-semibold">{money(l.net_payable)}</td>}
                <td className="px-4 py-2.5">
                  <StatusChip status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-sunken font-semibold">
                <td className="px-4 py-2.5" colSpan={showClient ? 5 : 4}>
                  Total, {lines.length} lines{lines.length >= 1000 ? " (first 1,000 — narrow the filters to see the rest)" : ""}
                </td>
                <td className="num px-3 py-2.5 text-right">{money(totals.gross)}</td>
                <td className="num px-3 py-2.5 text-right">{money(totals.comm)}</td>
                {!isDirect && <td className="num px-3 py-2.5 text-right">{money(totals.net)}</td>}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {isDirect && lines.length > 0 && (
        <p className="mt-3 text-sm text-ink-3">The commission column is what Plutus invoices for these royalties. Invoices arrive in the next update.</p>
      )}
    </div>
  );
}

function Select({
  name,
  label,
  value,
  options,
  all,
}: {
  name: string;
  label: string;
  value?: string;
  options: [string, string][];
  all: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={`f-${name}`}>
        {label}
      </label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className={`${inputCls} py-1.5 text-sm`}>
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </>
  );
}
