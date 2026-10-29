import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { getNotifications } from "@/lib/data";

const KIND: Record<string, string> = {
  report_uploaded: "New report",
  statement_available: "Statement",
  payment_update: "Payment",
  data_mismatch: "Needs attention",
  system: "System",
};

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function NotificationsPage() {
  const notes = await getNotifications();
  return (
    <div>
      <PageTitle title="Notifications" intro="New reports, statements, payment updates and data problems." />
      {notes.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-ink-3">Nothing new. You will see updates here.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {notes.map((n) => (
            <li key={n.id} className={`flex gap-4 px-5 py-4 ${n.read_at ? "" : "bg-sunken"}`}>
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : n.type === "data_mismatch" ? "bg-bad" : "bg-brand"}`}
                aria-label={n.read_at ? "Read" : "Unread"}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-medium ${n.type === "data_mismatch" ? "text-bad" : "text-ink-3"}`}>
                  {KIND[n.type] ?? n.type}, {when.format(new Date(n.created_at))}
                </p>
                <p className="font-semibold">{n.title}</p>
                {n.body && <p className="text-sm text-ink-2">{n.body}</p>}
              </div>
              {n.link && (
                <Link href={n.link} className="self-center text-sm font-semibold text-brand hover:underline">
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
