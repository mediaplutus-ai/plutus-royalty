import "server-only";
import { getViewer } from "./data";
import type { AppRole } from "./types";

/** Every server action re-checks who is calling (the database checks again with row level security). */
export async function actor(...roles: AppRole[]) {
  const viewer = await getViewer();
  if (roles.length && !roles.includes(viewer.role)) {
    throw new Error("You do not have permission to do this.");
  }
  return viewer;
}

export const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
export const opt = (fd: FormData, key: string) => str(fd, key) || null;

/** Comma / space / newline separated codes -> clean upper-case list. */
export const codes = (raw: string) =>
  raw
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

/** Turn database errors into sentences a non-technical user understands. */
export function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("artists_ipi_uq")) return "Another rights holder already has this IPI number.";
  if (m.includes("works_iswc_uq") || m.includes("already used by another work")) return "This ISWC is already used by another work in the catalog.";
  if (m.includes("iswc_format")) return "ISWC should look like T-123.456.789-0.";
  if (m.includes("invitations_open_email_uq")) return "This email already has an open invitation. Revoke it first or copy its link.";
  if (m.includes("invite_email_format")) return "That email address does not look right.";
  if (m.includes("label_admin_needs_label") || m.includes("invite_label_admin_needs_label")) return "A Label Admin must belong to a label. Choose the label.";
  if (m.includes("contract_party")) return "Choose the label or the rights holder this contract is with.";
  if (m.includes("contract_dates")) return "The end date cannot be before the effective date.";
  if (m.includes("row-level security")) return "You do not have permission to do this.";
  if (m.includes("duplicate key")) return "This already exists.";
  return message.replace(/^.*?ERROR:\s*/i, "");
}
