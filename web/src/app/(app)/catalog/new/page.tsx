import Link from "next/link";
import { PageTitle, Panel } from "@/components/ui";
import { getArtists, getLabels } from "@/lib/admin-data";
import { requireRole } from "@/lib/guard";
import { WorkForm } from "../WorkForm";

export default async function NewWorkPage() {
  const viewer = await requireRole("super_admin", "label_admin");
  const [artists, labels] = await Promise.all([getArtists(), getLabels()]);
  return (
    <div>
      <Link href="/catalog" className="text-sm font-semibold text-brand hover:underline">
        ← Works & catalog
      </Link>
      <PageTitle title="Add a work" intro="Add the song, its codes and who owns which share. Royalties match to it by ISWC, then ISRC, then title." />
      <Panel>
        <WorkForm
          isSuper={viewer.role === "super_admin"}
          artists={artists.filter((a) => a.is_active).map((a) => ({ id: a.id, name: `${a.stage_name}${a.ipi_number ? ` · IPI ${a.ipi_number}` : ""}` }))}
          labels={labels.map((l) => ({ id: l.id, name: l.name }))}
        />
      </Panel>
    </div>
  );
}
