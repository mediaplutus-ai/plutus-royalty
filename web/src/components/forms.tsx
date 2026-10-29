"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/** Result every Session 2 server action returns to its form. */
export type ActionState = { error?: string; ok?: string } | undefined;

export const inputCls =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-ink-3 disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
  tone = "primary",
  className = "",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  tone?: "primary" | "plain" | "danger";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const cls =
    tone === "primary"
      ? "bg-brand text-white hover:opacity-90"
      : tone === "danger"
        ? "border border-bad/50 text-bad hover:bg-sunken"
        : "border border-line hover:bg-sunken";
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60 ${cls} ${className}`}
    >
      {pending ? (pendingText ?? "Saving") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="rounded-md border border-bad/40 bg-sunken px-3 py-2 text-sm text-bad">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="rounded-md border border-ok/40 bg-sunken px-3 py-2 text-sm text-ok">
        {state.ok}
      </p>
    );
  return null;
}

/** Read-only box with a copy button — used for invitation links. */
export function CopyBox({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <input readOnly value={value} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked: the text box is selectable */
          }
        }}
        className="shrink-0 rounded-md border border-line px-3 text-sm font-semibold hover:bg-sunken"
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}
