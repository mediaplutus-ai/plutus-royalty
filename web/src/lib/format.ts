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
