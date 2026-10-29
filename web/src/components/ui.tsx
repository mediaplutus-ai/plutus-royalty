import type { RoyaltyStatus } from "@/lib/types";

const STATUS: Record<RoyaltyStatus | string, { label: string; icon: string; cls: string }> = {
  pending: { label: "Pending", icon: "◷", cls: "text-ink-2 bg-sunken border-line" },
  approved: { label: "Approved", icon: "✓", cls: "text-ink-2 bg-sunken border-line" },
  on_hold: { label: "On hold", icon: "‖", cls: "text-warn bg-sunken border-warn/40" },
  disputed: { label: "Disputed", icon: "!", cls: "text-bad bg-sunken border-bad/40" },
  paid: { label: "Paid", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  paid_directly: { label: "Paid directly", icon: "↗", cls: "text-ink-2 bg-sunken border-line" },
  matched: { label: "Matched", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  unmatched: { label: "Not matched", icon: "!", cls: "text-bad bg-sunken border-bad/40" },
  registered: { label: "Registered", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  submitted: { label: "Submitted", icon: "◷", cls: "text-ink-2 bg-sunken border-line" },
  draft: { label: "Draft", icon: "○", cls: "text-ink-3 bg-sunken border-line" },
  inactive: { label: "Inactive", icon: "○", cls: "text-ink-3 bg-sunken border-line" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, icon: "•", cls: "text-ink-2 bg-sunken border-line" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export function TypeTag({ type }: { type: "publisher" | "admin_only" }) {
  return type === "publisher" ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-2">
      <span className="h-2.5 w-2.5 rounded-sm bg-net" aria-hidden />
      Collected by Plutus
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-2">
      <span className="h-2.5 w-2.5 rounded-sm bg-direct" aria-hidden />
      Paid directly
    </span>
  );
}

export function PageTitle({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="mb-7 max-w-2xl">
      <h1 className="text-[1.9rem] font-extrabold leading-tight tracking-tight">{title}</h1>
      {intro && <p className="mt-1.5 text-ink-2">{intro}</p>}
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title?: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>
      {title && (
        <header className="mb-4">
          <h2 className="text-base font-bold">{title}</h2>
          {note && <p className="text-sm text-ink-3">{note}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Honest placeholder for modules that arrive in a later build session. */
export function ComingSoon({ session, columns, what }: { session: string; columns: string[]; what: string }) {
  return (
    <Panel>
      <p className="text-ink-2">{what}</p>
      <p className="mt-4 text-sm font-semibold">Columns this page will show</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {columns.map((c) => (
          <li key={c} className="rounded border border-line bg-sunken px-2 py-1 text-sm text-ink-2">
            {c}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-ink-3">Arrives in {session}. The database tables for it are already in place.</p>
    </Panel>
  );
}
