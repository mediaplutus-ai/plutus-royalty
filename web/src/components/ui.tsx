import Link from "next/link";
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
  disputed_work: { label: "Disputed", icon: "!", cls: "text-bad bg-sunken border-bad/40" },
  under_review: { label: "Under review", icon: "◔", cls: "text-warn bg-sunken border-warn/40" },
  needs_changes: { label: "Needs changes", icon: "!", cls: "text-bad bg-sunken border-bad/40" },
  active: { label: "Active", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  expired: { label: "Expired", icon: "○", cls: "text-ink-3 bg-sunken border-line" },
  terminated: { label: "Terminated", icon: "×", cls: "text-ink-3 bg-sunken border-line" },
  invite_open: { label: "Waiting to join", icon: "◷", cls: "text-ink-2 bg-sunken border-line" },
  invite_accepted: { label: "Joined", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  invite_revoked: { label: "Revoked", icon: "×", cls: "text-ink-3 bg-sunken border-line" },
  invite_expired: { label: "Link expired", icon: "○", cls: "text-ink-3 bg-sunken border-line" },
  user_on: { label: "Can sign in", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  user_off: { label: "Switched off", icon: "○", cls: "text-bad bg-sunken border-bad/40" },
  published: { label: "Published", icon: "✓", cls: "text-ok bg-sunken border-ok/40" },
  hidden: { label: "Hidden", icon: "◌", cls: "text-warn bg-sunken border-warn/40" },
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

/** Row of page tabs driven by ?tab= in the URL. */
export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav aria-label="Sections" className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-semibold ${
            t.key === current ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function LinkButton({ href, children, tone = "primary" }: { href: string; children: React.ReactNode; tone?: "primary" | "plain" }) {
  return (
    <Link
      href={href}
      className={`inline-block rounded-md px-4 py-2 text-sm font-semibold ${
        tone === "primary" ? "bg-brand text-white hover:opacity-90" : "border border-line hover:bg-sunken"
      }`}
    >
      {children}
    </Link>
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
