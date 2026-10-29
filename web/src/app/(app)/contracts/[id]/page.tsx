import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Panel } from "@/components/ui";
import { getArtists, getContract, getLabels } from "@/lib/admin-data";
import { requireRole } from "@/lib/guard";
import { ContractForm } from "../ContractForm";

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("super_admin");
  const { id } = await params;
  const [contract, labels, artists] = await Promise.all([getContract(id), getLabels(), getArtists()]);
  if (!contract) notFound();
  return (
    <div>
      <Link href="/contracts" className="text-sm font-semibold text-brand hover:underline">
        ← Contracts
      </Link>
      <PageTitle title={`Contract with ${contract.artist_name ?? contract.label_name}`} />
      <Panel>
        <ContractForm
          contract={contract}
          labels={labels.map((l) => ({ id: l.id, name: l.name }))}
          artists={artists.map((a) => ({ id: a.id, name: `${a.stage_name}${a.label_name ? ` · ${a.label_name}` : ""}` }))}
        />
      </Panel>
    </div>
  );
}
