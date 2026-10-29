import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Panel } from "@/components/ui";
import { getArtist, getLabels } from "@/lib/admin-data";
import { requireRole } from "@/lib/guard";
import { ArtistForm } from "../../forms";

export default async function EditHolderPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("super_admin", "label_admin");
  const { id } = await params;
  const [artist, labels] = await Promise.all([getArtist(id), getLabels()]);
  if (!artist) notFound();

  return (
    <div>
      <Link href="/people?tab=holders" className="text-sm font-semibold text-brand hover:underline">
        ← Rights holders
      </Link>
      <PageTitle title={artist.stage_name} intro="Details used for matching royalties and on statements." />
      <Panel>
        <ArtistForm artist={artist} viewerRole={viewer.role} labels={labels.map((l) => ({ id: l.id, name: l.name }))} />
      </Panel>
      <p className="mt-4 text-sm text-ink-3">
        Bank details are stored encrypted and are managed by the Plutus team (arrives with payments in Session 5).
      </p>
    </div>
  );
}
