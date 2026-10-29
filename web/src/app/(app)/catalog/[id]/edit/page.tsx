import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Panel } from "@/components/ui";
import { getArtists, getLabels, getWork } from "@/lib/admin-data";
import { requireRole } from "@/lib/guard";
import { WorkForm } from "../../WorkForm";

export default async function EditWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("super_admin", "label_admin");
  const { id } = await params;
  const [work, artists, labels] = await Promise.all([getWork(id), getArtists(), getLabels()]);
  if (!work) notFound();
  return (
    <div>
      <Link href="/catalog" className="text-sm font-semibold text-brand hover:underline">
        ← Works & catalog
      </Link>
      <PageTitle title={`Edit ${work.title}`} intro="Changes to ownership apply to royalties imported from now on." />
      <Panel>
        <WorkForm
          work={work}
          isSuper={viewer.role === "super_admin"}
          artists={artists.map((a) => ({ id: a.id, name: `${a.stage_name}${a.ipi_number ? ` · IPI ${a.ipi_number}` : ""}${a.is_active ? "" : " (inactive)"}` }))}
          labels={labels.map((l) => ({ id: l.id, name: l.name }))}
        />
      </Panel>
    </div>
  );
}
