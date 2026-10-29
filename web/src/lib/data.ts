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
    .select("id, email, full_name, role, is_active, labels(name)")
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
