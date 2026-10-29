import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "./supabase/server";
import * as demo from "./demo";
import type {
  AppRole,
  BreakdownRow,
  CatalogRow,
  Kpis,
  NotificationRow,
  RoyaltyFilters,
  RoyaltyLine,
  RoyaltyType,
  Viewer,
} from "./types";

/**
 * One place for all reads. With Supabase keys set it reads the real database
 * (row level security decides what each person sees); without keys it serves demo data.
 */
export const isDemo = () => !supabaseConfigured();

async function demoRole(): Promise<AppRole> {
  const c = (await cookies()).get("demo_role")?.value as AppRole | undefined;
  return c && c in demo.DEMO_VIEWERS ? c : "super_admin";
}

export async function getViewer(): Promise<Viewer> {
  if (isDemo()) return demo.DEMO_VIEWERS[await demoRole()];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, label_id, is_active, labels(name)")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) redirect("/login?error=inactive");

  const label = profile.labels as unknown as { name: string } | null;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name ?? profile.email,
    role: profile.role as AppRole,
    labelName: label?.name ?? null,
    labelId: profile.label_id ?? null,
  };
}

const num = (v: unknown) => Number(v ?? 0);

export async function getKpis(): Promise<Kpis> {
  if (isDemo()) return demo.demoKpis(await demoRole());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_kpis");
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    lifetime_gross: num(r.lifetime_gross),
    lifetime_commission: num(r.lifetime_commission),
    lifetime_net: num(r.lifetime_net),
    admin_only_lifetime: num(r.admin_only_lifetime),
    current_period_start: r.current_period_start ?? null,
    current_period_end: r.current_period_end ?? null,
    current_period_net: num(r.current_period_net),
    current_period_admin_only: num(r.current_period_admin_only),
    pending_net: num(r.pending_net),
    paid_net: num(r.paid_net),
    admin_only_fee: num(r.admin_only_fee),
    admin_only_fee_open: num(r.admin_only_fee_open),
  };
}

export async function getBreakdown(dim: "source" | "territory" | "month"): Promise<BreakdownRow[]> {
  if (isDemo()) return demo.demoBreakdown(await demoRole(), dim);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("earnings_breakdown", { p_dimension: dim });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: BreakdownRow) => ({
    bucket: r.bucket,
    publisher_gross: num(r.publisher_gross),
    commission: num(r.commission),
    publisher_net: num(r.publisher_net),
    admin_only: num(r.admin_only),
  }));
}

export async function getRoyaltyLines(type?: RoyaltyType, limit = 200): Promise<RoyaltyLine[]> {
  if (isDemo()) {
    const rows = demo.demoLines(await demoRole());
    return rows
      .filter((l) => !type || l.royalty_type === type)
      .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.gross_amount - a.gross_amount)
      .slice(0, limit);
  }
  const supabase = await createClient();
  let q = supabase
    .from("v_royalty_lines")
    .select("*")
    .order("period_start", { ascending: false })
    .order("gross_amount", { ascending: false })
    .limit(limit);
  if (type) q = q.eq("royalty_type", type);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as RoyaltyLine[];
}

export async function getCatalog(): Promise<CatalogRow[]> {
  if (isDemo()) return demo.demoCatalog(await demoRole());
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_catalog").select("*").order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogRow[];
}

export async function getNotifications(): Promise<NotificationRow[]> {
  if (isDemo()) return demo.demoNotifications(await demoRole());
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as NotificationRow[];
}

/** Royalties page: one royalty type with the filters from the URL. */
export async function getFilteredLines(type: RoyaltyType, f: RoyaltyFilters, limit = 1000): Promise<RoyaltyLine[]> {
  if (isDemo()) {
    const rows = (await getRoyaltyLines(type, 500)).filter(
      (l) =>
        (!f.q || (l.work_title ?? "").toLowerCase().includes(f.q.toLowerCase())) &&
        (!f.territory || l.territory === f.territory) &&
        (!f.client || (l.label_name ?? l.artist_name) === f.client) &&
        (!f.year || l.period_start.startsWith(f.year)) &&
        (!f.status || l.status === f.status) &&
        (!f.licensee || (l.licensee ?? l.source) === f.licensee),
    );
    return rows.slice(0, limit);
  }
  const supabase = await createClient();
  let q = supabase
    .from("v_royalty_lines")
    .select("*")
    .eq("royalty_type", type)
    .order("period_start", { ascending: false })
    .order("gross_amount", { ascending: false })
    .limit(limit);
  if (f.q) q = q.ilike("work_title", `%${f.q.replace(/[%_]/g, "")}%`);
  if (f.licensee) {
    const v = f.licensee.replace(/"/g, "");
    q = q.or(`licensee.eq."${v}",and(licensee.is.null,source.eq."${v}")`);
  }
  if (f.territory) q = q.eq("territory", f.territory);
  if (f.client) q = q.or(`label_name.eq."${f.client.replace(/"/g, "")}",artist_name.eq."${f.client.replace(/"/g, "")}"`);
  if (f.year && /^\d{4}$/.test(f.year)) q = q.gte("period_start", `${f.year}-01-01`).lte("period_start", `${f.year}-12-31`);
  if (f.status) q = q.eq("status", f.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => ({
    ...l,
    gross_amount: Number(l.gross_amount),
    commission_amount: Number(l.commission_amount),
    net_payable: Number(l.net_payable),
  })) as RoyaltyLine[];
}

/** Values for the filter menus, from what this person is allowed to see. */
export async function getFilterOptions(): Promise<{ licensees: string[]; territories: string[]; clients: string[]; years: string[] }> {
  if (isDemo()) {
    const lines = await getRoyaltyLines(undefined, 500);
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
    return {
      licensees: uniq(lines.map((l) => l.licensee ?? l.source)),
      territories: uniq(lines.map((l) => l.territory)),
      clients: uniq(lines.map((l) => l.label_name ?? l.artist_name)),
      years: uniq(lines.map((l) => l.period_start.slice(0, 4))).reverse(),
    };
  }
  const supabase = await createClient();
  const dims = ["licensee", "territory", "client", "month"] as const;
  const res = await Promise.all(dims.map((d) => supabase.rpc("earnings_breakdown", { p_dimension: d })));
  const buckets = res.map((r) => ((r.data ?? []) as BreakdownRow[]).map((b) => b.bucket).filter(Boolean));
  return {
    licensees: [...buckets[0]].sort(),
    territories: [...buckets[1]].sort(),
    clients: [...buckets[2]].sort(),
    years: [...new Set(buckets[3].map((m) => m.slice(0, 4)))].sort().reverse(),
  };
}
