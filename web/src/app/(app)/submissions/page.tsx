import Link from "next/link";
import { LinkButton, PageTitle, Panel, StatusChip, Tabs } from "@/components/ui";
import { getSubmissions } from "@/lib/admin-data";
import { getViewer, isDemo } from "@/lib/data";
import { dateLabel } from "@/lib/format";

type SP = Promise<{ show?: string; withdrawn?: string }>;

export default async function SubmissionsPage({ searchParams }: { searchParams: SP }) {
  const viewer = await getViewer();
  const { show, withdrawn } = await searchParams;
  const isSuper = viewer.role === "super_admin";

  if (isDemo()) {
    return (
      <div>
        <PageTitle title="Work submissions" />
        <Panel>Connect the database to submit works.</Panel>
      </div>
    );
  }

  const all = await getSubmissions();
  const filters = {
    open: (s: (typeof all)[number]) => s.status === "submitted" || s.status === "under_review",
    changes: (s: (typeof all)[number]) => s.status === "needs_changes",
    registered: (s: (typeof all)[number]) => s.status === "registered",
    all: () => true,
  };
  const current = (show && show in filters ? show : isSuper ? "open" : "all") as keyof typeof filters;
  const rows = all.filter(filters[current]);
  const count = (k: keyof typeof filters) => all.filter(filters[k]).length;

  return (
    <div>
      <PageTitle
        title="Work submissions"
        intro={
          isSuper
            ? "New songs sent by writers and labels. Review them, register with IPRS, and add the ISWC — the work then joins the catalog."
            : "Send a new song to Plutus for IPRS registration and follow its progress here."
        }
      />
      <div className="mb-5">
        <LinkButton href="/submissions/new">Submit a new work</LinkButton>
      </div>
      {withdrawn && (
        <p role="status" className="mb-5 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          Submission withdrawn.
        </p>
      )}
      <Tabs
        current={current}
        tabs={[
          { key: "open", label: `Waiting (${count("open")})`, href: "/submissions?show=open" },
          { key: "changes", label: `Needs changes (${count("changes")})`, href: "/submissions?show=changes" },
          { key: "registered", label: `Registered (${count("registered")})`, href: "/submissions?show=registered" },
          { key: "all", label: `All (${all.length})`, href: "/submissions?show=all" },
        ]}
      />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">Song</th>
              <th className="px-3 py-2.5 font-medium">Writers</th>
              {viewer.role !== "author_composer" && <th className="px-3 py-2.5 font-medium">Sent by</th>}
              <th className="px-3 py-2.5 font-medium">Last change</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-3">
                  Nothing here.
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/submissions/${s.id}`} className="font-semibold text-brand hover:underline">
                    {s.title}
                  </Link>
                  {s.iswc && <span className="num block text-xs text-ink-3">{s.iswc}</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-2">{s.writers.map((w) => `${w.name} ${Number(w.share_pct)}%`).join(", ")}</td>
                {viewer.role !== "author_composer" && (
                  <td className="px-3 py-2.5 text-ink-2">
                    {s.submitter_name ?? s.submitter_email}
                    {s.label_name && <span className="block text-xs text-ink-3">{s.label_name}</span>}
                  </td>
                )}
                <td className="px-3 py-2.5 text-ink-2">{dateLabel(s.updated_at)}</td>
                <td className="px-4 py-2.5">
                  <StatusChip status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
