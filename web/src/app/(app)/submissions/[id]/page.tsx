import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton, PageTitle, Panel, StatusChip } from "@/components/ui";
import { getSubmission, signedFileLinks } from "@/lib/admin-data";
import { getViewer } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import { withdrawSubmission } from "../actions";
import { ReviewForms } from "../ReviewForms";

const ROLE: Record<string, string> = { composer: "Music", author: "Lyrics", composer_author: "Lyrics & music" };
const STEPS = [
  ["submitted", "Submitted"],
  ["under_review", "Under review"],
  ["registered", "Registered with IPRS"],
] as const;

export default async function SubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [viewer, { id }, { saved }] = await Promise.all([getViewer(), params, searchParams]);
  const s = await getSubmission(id);
  if (!s) notFound();
  const files = await signedFileLinks(s.files);

  const isSuper = viewer.role === "super_admin";
  const editable = s.status === "submitted" || s.status === "needs_changes";
  const canEdit = editable && (s.submitted_by === viewer.id || viewer.role === "label_admin" || isSuper);
  const canWithdraw = editable && (s.submitted_by === viewer.id || isSuper);
  const stepIndex = s.status === "registered" ? 2 : s.status === "under_review" ? 1 : 0;

  return (
    <div>
      <Link href="/submissions" className="text-sm font-semibold text-brand hover:underline">
        ← Work submissions
      </Link>
      <PageTitle title={s.title} intro={`Sent by ${s.submitter_name ?? s.submitter_email}${s.label_name ? ` (${s.label_name})` : ""} on ${dateLabel(s.created_at)}.`} />

      {saved && (
        <p role="status" className="mb-5 rounded-md border border-ok/40 bg-surface px-3 py-2 text-sm text-ok">
          Sent to Plutus. You will get a notification at each step.
        </p>
      )}

      <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Progress">
        {STEPS.map(([key, label], i) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 font-semibold ${
                i <= stepIndex && s.status !== "needs_changes" ? "border-brand bg-brand text-white" : "border-line text-ink-3"
              }`}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-3" aria-hidden>→</span>}
          </li>
        ))}
        {s.status === "needs_changes" && <StatusChip status="needs_changes" />}
      </ol>

      {s.status === "needs_changes" && s.reviewer_note && (
        <Panel className="mb-6 border-bad/40">
          <p className="font-semibold text-bad">Plutus asked for a change</p>
          <p className="mt-1">{s.reviewer_note}</p>
        </Panel>
      )}
      {s.status === "registered" && (
        <Panel className="mb-6 border-ok/40">
          <p className="font-semibold text-ok">Registered with IPRS</p>
          <p className="mt-1">
            ISWC <span className="num font-semibold">{s.iswc}</span>. The work is in{" "}
            <Link href="/catalog" className="font-semibold text-brand hover:underline">
              Works & catalog
            </Link>{" "}
            and royalties will be matched to it.
          </p>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Song details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-3">Language</dt>
              <dd>{s.language ?? "—"}</dd>
              <dt className="text-ink-3">Release date</dt>
              <dd>{dateLabel(s.release_date)}</dd>
              <dt className="text-ink-3">ISRC</dt>
              <dd className="num">{s.isrc.length ? s.isrc.join(", ") : "—"}</dd>
              <dt className="text-ink-3">Notes</dt>
              <dd className="whitespace-pre-line">{s.notes ?? "—"}</dd>
            </dl>
          </Panel>
          <Panel title="Writers and shares">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">IPI</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="py-2 pl-3 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {s.writers.map((w, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 font-semibold">{w.name}</td>
                    <td className="num px-3 py-2 text-ink-2">{w.ipi || "—"}</td>
                    <td className="px-3 py-2 text-ink-2">{ROLE[w.role] ?? w.role}</td>
                    <td className="num py-2 pl-3 text-right font-semibold">{Number(w.share_pct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Files">
            {files.length === 0 ? (
              <p className="text-ink-3">No files attached.</p>
            ) : (
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li key={f.path}>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
                        {f.name}
                      </a>
                    ) : (
                      <span className="text-ink-3">{f.name} (not available)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {isSuper && s.status !== "registered" && (
            <Panel title="Plutus review">
              <ReviewForms id={s.id} status={s.status} />
            </Panel>
          )}
          {(canEdit || canWithdraw) && (
            <Panel title="Change this submission">
              <div className="flex flex-wrap gap-3">
                {canEdit && <LinkButton href={`/submissions/${s.id}/edit`}>Edit and re-submit</LinkButton>}
                {canWithdraw && (
                  <form action={withdrawSubmission.bind(null, s.id)}>
                    <button className="rounded-md border border-bad/50 px-4 py-2 text-sm font-semibold text-bad hover:bg-sunken">Withdraw</button>
                  </form>
                )}
              </div>
            </Panel>
          )}
          {!isSuper && s.status === "under_review" && (
            <Panel>
              <p className="text-ink-2">Plutus is working on this. You cannot change it now; we will tell you when it is registered or if something is needed.</p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
