const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹2,17,904 for whole rupees, ₹2,17,903.80 when there are paise. */
export function money(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0) * 100) / 100;
  return Number.isInteger(v) ? whole.format(v) : paise.format(v);
}

const month = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });

export function periodLabel(start?: string | null, end?: string | null): string {
  if (!start) return "No data yet";
  const s = new Date(start);
  const e = end ? new Date(end) : s;
  const a = month.format(s);
  const b = month.format(e);
  return a === b ? a : `${a} – ${b}`;
}

export const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  label_admin: "Label Admin",
  author_composer: "Author / Composer",
};

export const territoryName: Record<string, string> = {
  IN: "India",
  GB: "United Kingdom",
  US: "United States",
  AE: "UAE",
  CA: "Canada",
  AU: "Australia",
  WORLD: "Worldwide",
};

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** 29 Oct 2026 */
export function dateLabel(v?: string | null): string {
  return v ? day.format(new Date(v)) : "—";
}

export const creatorRoleLabel: Record<string, string> = {
  composer: "Composer",
  author: "Author (lyricist)",
  composer_author: "Composer & author",
  arranger: "Arranger",
  original_publisher: "Publisher",
  sub_publisher: "Sub-publisher",
  performer: "Performer",
};
