import Link from "next/link";
import { PageTitle, Panel } from "@/components/ui";
import { getMyArtists } from "@/lib/admin-data";
import { getViewer } from "@/lib/data";
import { SubmissionForm } from "../SubmissionForm";

export default async function NewSubmissionPage() {
  const viewer = await getViewer();
  const mine = viewer.role === "author_composer" ? await getMyArtists(viewer.id) : [];
  const me = mine[0] ? { name: mine[0].stage_name, ipi: mine[0].ipi_number, artist_id: mine[0].id } : null;
  return (
    <div>
      <Link href="/submissions" className="text-sm font-semibold text-brand hover:underline">
        ← Work submissions
      </Link>
      <PageTitle
        title="Submit a new work"
        intro="Send the song details to Plutus. We check them, register the work with IPRS and add the ISWC. You will see each step here and in notifications."
      />
      <Panel>
        <SubmissionForm userId={viewer.id} me={me} />
      </Panel>
    </div>
  );
}
