import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageTitle, Panel } from "@/components/ui";
import { getSubmission } from "@/lib/admin-data";
import { getViewer } from "@/lib/data";
import { SubmissionForm } from "../../SubmissionForm";

export default async function EditSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  const { id } = await params;
  const s = await getSubmission(id);
  if (!s) notFound();
  if (s.status !== "submitted" && s.status !== "needs_changes") redirect(`/submissions/${id}`);

  return (
    <div>
      <Link href={`/submissions/${id}`} className="text-sm font-semibold text-brand hover:underline">
        ← {s.title}
      </Link>
      <PageTitle title={`Edit ${s.title}`} intro="Saving sends it back to Plutus for review." />
      {s.reviewer_note && (
        <p className="mb-5 rounded-md border border-bad/40 bg-surface px-3 py-2 text-sm">
          <span className="font-semibold text-bad">Plutus asked: </span>
          {s.reviewer_note}
        </p>
      )}
      <Panel>
        <SubmissionForm
          userId={viewer.id}
          submission={{ ...s, files: s.files.map((p) => ({ path: p, name: p.split("/").pop()?.replace(/^\d+-/, "") ?? p })) }}
        />
      </Panel>
    </div>
  );
}
