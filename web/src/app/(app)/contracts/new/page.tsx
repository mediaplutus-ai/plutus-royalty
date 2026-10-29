import Link from "next/link";
import { PageTitle, Panel } from "@/components/ui";
import { getArtists, getLabels } from "@/lib/admin-data";
import { requireRole } from "@/lib/guard";
import { ContractForm } from "../ContractForm";

export default async function NewContractPage() {
  await requireRole("super_admin");
  const [labels, artists] = await Promise.all([getLabels(), getArtists()]);
  return (
    <div>
      <Link href="/contracts" className="text-sm font-semibold text-brand hover:underline">
        ← Contracts
      </Link>
      <PageTitle title="Add a contract" />
      <Panel>
        <ContractForm
          labels={labels.map((l) => ({ id: l.id, name: l.name }))}
          artists={artists.map((a) => ({ id: a.id, name: `${a.stage_name}${a.label_name ? ` · ${a.label_name}` : ""}` }))}
        />
      </Panel>
    </div>
  );
}
