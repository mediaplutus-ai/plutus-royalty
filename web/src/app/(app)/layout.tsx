import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { getNotifications, getViewer, isDemo } from "@/lib/data";
import { roleLabel } from "@/lib/format";
import { signOut, switchDemoRole } from "../actions";
import type { AppRole } from "@/lib/types";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Everything here depends on who is signed in, so it renders per request behind Suspense.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen md:pl-60">
          <div className="fixed inset-y-0 left-0 hidden w-60 bg-nav md:block" />
          <p className="px-8 py-10 text-ink-3">Loading your royalties</p>
        </div>
      }
    >
      <AppFrame>{children}</AppFrame>
    </Suspense>
  );
}

async function AppFrame({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const notes = await getNotifications();
  const unread = notes.filter((n) => !n.read_at).length;
  const demo = isDemo();

  return (
    <div className="min-h-screen">
      <Sidebar role={viewer.role} unread={unread} />
      <div className="md:pl-60">
        <header className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-b border-line bg-surface px-5 py-3 pl-24 md:pl-8">
          {demo && (
            <form action={switchDemoRole} className="mr-auto flex items-center gap-2 text-sm">
              <span className="rounded bg-direct/15 px-2 py-0.5 font-semibold text-direct">Demo data</span>
              <label htmlFor="demo-role" className="text-ink-3">
                View as
              </label>
              <select
                id="demo-role"
                name="role"
                defaultValue={viewer.role}
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink"
              >
                {(Object.keys(roleLabel) as AppRole[]).map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
              <button className="rounded-md border border-line px-2 py-1 font-medium hover:bg-sunken">Switch</button>
            </form>
          )}
          <div className="text-right text-sm leading-tight">
            <p className="font-semibold">{viewer.fullName}</p>
            <p className="text-ink-3">
              {roleLabel[viewer.role]}
              {viewer.role !== "super_admin" && viewer.labelName ? `, ${viewer.labelName}` : ""}
            </p>
          </div>
          <form action={signOut}>
            <button className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-sunken">
              Sign out
            </button>
          </form>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
