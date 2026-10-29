"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton, inputCls, type ActionState } from "@/components/forms";
import type { ClientCommission } from "@/lib/admin-data";
import { money } from "@/lib/format";
import { setClientCommission, setDefaultCommission } from "./actions";

function PctInput({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        name="pct"
        type="number"
        min="0"
        max="100"
        step="0.01"
        defaultValue={value}
        aria-label={label}
        className={`${inputCls} num w-20 px-2 py-1 text-right`}
      />
      <span className="text-ink-3">%</span>
    </span>
  );
}

function ClientRow({ c }: { c: ClientCommission }) {
  const [state, action] = useActionState<ActionState, FormData>(setClientCommission.bind(null, c.kind, c.id), undefined);
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-3">
        <span className="font-semibold">{c.name}</span>
        <span className="block text-xs text-ink-3">
          {c.kind === "label" ? "Label" : `Rights holder${c.label_name ? ` · ${c.label_name}` : ""}`}
          {c.is_default ? " · using default" : ""}
        </span>
      </td>
      <td className="num px-3 py-2 text-right text-ink-2">{money(c.open_gross)}</td>
      <td className="num px-3 py-2 text-right text-ink-2">{money(c.open_commission)}</td>
      <td className="py-2 pl-3">
        <form action={action} className="flex flex-wrap items-center justify-end gap-2">
          <PctInput value={c.commission_pct} label={`Commission for ${c.name}`} />
          <SubmitButton tone="plain" className="px-3 py-1">
            Save
          </SubmitButton>
          {state?.error && <span className="w-full text-right text-xs text-bad">{state.error}</span>}
          {state?.ok && <span className="w-full text-right text-xs text-ok">{state.ok}</span>}
        </form>
      </td>
    </tr>
  );
}

export function CommissionPanel({ defaultPct, clients }: { defaultPct: number; clients: ClientCommission[] }) {
  const [dState, dAction] = useActionState<ActionState, FormData>(setDefaultCommission, undefined);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(clients.length <= 8);
  const shown = clients.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="rounded-lg border border-brand/40 bg-surface p-5" aria-labelledby="commission-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 id="commission-title" className="text-base font-bold">
            Plutus commission
          </h2>
          <p className="text-sm text-ink-3">
            Change any client&apos;s % here. Royalties not yet paid or invoiced are re-calculated straight away; paid ones stay as they were.
          </p>
        </div>
        <form action={dAction} className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold" htmlFor="default-pct">
            Default for clients without a contract
          </label>
          <input
            id="default-pct"
            name="pct"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue={defaultPct}
            className={`${inputCls} num w-20 px-2 py-1 text-right`}
          />
          <span className="text-ink-3">%</span>
          <SubmitButton className="px-3 py-1">Save</SubmitButton>
          {dState?.error && <span className="w-full text-sm text-bad">{dState.error}</span>}
          {dState?.ok && <span className="w-full text-sm text-ok">{dState.ok}</span>}
        </form>
      </div>

      {clients.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          No clients yet. They appear here when you add labels or import a statement.{" "}
          <Link href="/uploads" className="font-semibold text-brand hover:underline">
            Upload a statement
          </Link>
        </p>
      ) : (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Find a client"
              aria-label="Find a client"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOpen(true);
              }}
              className={`${inputCls} max-w-xs py-1 text-sm`}
            />
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm font-semibold text-brand hover:underline">
              {open ? "Hide clients" : `Show all ${clients.length} clients`}
            </button>
          </div>
          {open && (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Open royalty</th>
                    <th className="px-3 py-2 text-right font-medium">Open commission</th>
                    <th className="py-2 pl-3 text-right font-medium">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <ClientRow key={`${c.kind}-${c.id}`} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
