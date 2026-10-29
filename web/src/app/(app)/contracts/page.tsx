import Link from "next/link";
import { LinkButton, PageTitle, Panel, StatusChip } from "@/components/ui";
import { getContracts } from "@/lib/admin-data";
import { getViewer, isDemo } from "@/lib/data";
import { dateLabel, territoryName } from "@/lib/format";

const TYPE: Record<string, string> = {
  publishing: "Publishing",
  co_publishing: "Co-publishing",
  administration: "Administration",
  sub_publishing: "Sub-publishing",
  distribution: "Distribution",
};

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [viewer, { saved }] = await Promise.all([getViewer(), searchParams]);
  const isSuper = viewer.role === "super_admin";

  if (isDemo()) {
    return (
      <div>
        <PageTitle title="Contracts" />
        <Panel>Connect the database to see contracts.</Panel>
      </div>
    );
  }
  const contracts = await getContracts();

  return (
    <div>
      <PageTitle
        title="Contracts"
        intro={
          isSuper
            ? "Commission terms for each label and rights holder. A personal contract wins over the label-wide one."
            : "Your commission terms. Read-only: contact Plutus to change a contract."
        }
      />
      {isSuper && (
        <div className="mb-5">
          <LinkButton href="/contracts/new">Add a contract</LinkButton>
        </div>
      )}
      {saved && (
        <p role="status" className="mb-5 rounded-md border border-ok/40 bg-surface px-3 py-2 text-sm text-ok">
          Contract saved.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">With</th>
              <th className="px-3 py-2.5 font-medium">Contract type</th>
              <th className="px-3 py-2.5 text-right font-medium">Commission</th>
              <th className="px-3 py-2.5 font-medium">Effective</th>
              <th className="px-3 py-2.5 font-medium">Ends</th>
              <th className="px-3 py-2.5 font-medium">Territory coverage</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-3">
                  No contracts yet.
                </td>
              </tr>
            )}
            {contracts.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  {isSuper ? (
                    <Link href={`/contracts/${c.id}`} className="font-semibold text-brand hover:underline">
                      {c.artist_name ?? c.label_name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{c.artist_name ?? c.label_name}</span>
                  )}
                  <span className="block text-xs text-ink-3">{c.artist_id ? `Personal deal${c.label_name ? ` · ${c.label_name}` : ""}` : "Label-wide"}</span>
                </td>
                <td className="px-3 py-2.5">{TYPE[c.contract_type] ?? c.contract_type}</td>
                <td className="num px-3 py-2.5 text-right font-semibold">{c.commission_pct}%</td>
                <td className="px-3 py-2.5 text-ink-2">{dateLabel(c.effective_date)}</td>
                <td className="px-3 py-2.5 text-ink-2">{c.end_date ? dateLabel(c.end_date) : "No end date"}</td>
                <td className="px-3 py-2.5 text-ink-2">{c.territories.map((t) => territoryName[t] ?? t).join(", ")}</td>
                <td className="px-4 py-2.5">
                  <StatusChip status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-ink-3">Commission is taken only from royalties Plutus collects. Royalties a society pays you directly carry no commission.</p>
    </div>
  );
}
