import "server-only";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import type { AppRole } from "./types";

/**
 * Reads for Session 2 screens (people, catalog editing, submissions, contracts).
 * Row level security in the database decides what each signed-in person gets back.
 */

export interface LabelRow {
  id: string;
  name: string;
  contact_email: string | null;
  is_active: boolean;
}

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  label_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  label_name: string | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  label_id: string | null;
  artist_id: string | null;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  label_name: string | null;
  artist_name: string | null;
  is_expired: boolean;
}

export interface ArtistRow {
  id: string;
  label_id: string | null;
  user_id: string | null;
  stage_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  ipi_number: string | null;
  society: string | null;
  is_active: boolean;
  label_name: string | null;
}

export interface OwnershipRow {
  artist_id: string;
  role: string;
  share_pct: number;
  territory: string;
}

export interface WorkDetail {
  id: string;
  label_id: string | null;
  title: string;
  iswc: string | null;
  isrc: string[];
  language: string | null;
  genre: string | null;
  release_date: string | null;
  territories: string[];
  status: string;
  notes: string | null;
  owners: OwnershipRow[];
}

export interface ContractRow {
  id: string;
  label_id: string | null;
  artist_id: string | null;
  contract_type: string;
  commission_pct: number;
  effective_date: string;
  end_date: string | null;
  territories: string[];
  status: string;
  notes: string | null;
  label_name: string | null;
  artist_name: string | null;
}

export interface Writer {
  name: string;
  ipi?: string;
  role: "composer" | "author" | "composer_author";
  share_pct: number;
  artist_id?: string;
}

export interface SubmissionRow {
  id: string;
  submitted_by: string;
  label_id: string | null;
  title: string;
  language: string | null;
  release_date: string | null;
  isrc: string[];
  notes: string | null;
  writers: Writer[];
  files: string[];
  status: "submitted" | "under_review" | "needs_changes" | "registered";
  reviewer_note: string | null;
  iswc: string | null;
  work_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  submitter_name: string | null;
  submitter_email: string | null;
  label_name: string | null;
}

type Named = { name: string } | null;
type StageNamed = { stage_name: string } | null;
const one = <T,>(v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : v) as T;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function getLabels(): Promise<LabelRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("labels").select("id, name, contact_email, is_active").order("name");
  fail(error);
  return (data ?? []) as LabelRow[];
}

export async function getProfiles(): Promise<ProfileRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, full_name, role, label_id, is_active, last_login_at, created_at, labels(name)")
    .order("created_at", { ascending: false });
  fail(error);
  return (data ?? []).map((p) => ({ ...p, label_name: one<Named>(p.labels)?.name ?? null })) as ProfileRow[];
}

export async function getInvitations(): Promise<InvitationRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("invitations")
    .select("*, labels(name), artists(stage_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  const now = new Date();
  return (data ?? []).map((i) => ({
    ...i,
    is_expired: new Date(i.expires_at) < now,
    label_name: one<Named>(i.labels)?.name ?? null,
    artist_name: one<StageNamed>(i.artists)?.stage_name ?? null,
  })) as InvitationRow[];
}

export async function getArtists(): Promise<ArtistRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("artists")
    .select("id, label_id, user_id, stage_name, legal_name, email, phone, ipi_number, society, is_active, labels(name)")
    .order("stage_name");
  fail(error);
  return (data ?? []).map((a) => ({ ...a, label_name: one<Named>(a.labels)?.name ?? null })) as ArtistRow[];
}

export async function getArtist(id: string): Promise<ArtistRow | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("artists")
    .select("id, label_id, user_id, stage_name, legal_name, email, phone, ipi_number, society, is_active, labels(name)")
    .eq("id", id)
    .maybeSingle();
  return data ? ({ ...data, label_name: one<Named>(data.labels)?.name ?? null } as ArtistRow) : null;
}

/** The rights-holder records linked to the signed-in person's login. */
export async function getMyArtists(userId: string): Promise<ArtistRow[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("artists")
    .select("id, label_id, user_id, stage_name, legal_name, email, phone, ipi_number, society, is_active")
    .eq("user_id", userId);
  return (data ?? []).map((a) => ({ ...a, label_name: null })) as ArtistRow[];
}

export async function getWork(id: string): Promise<WorkDetail | null> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("works")
    .select("id, label_id, title, iswc, isrc, language, genre, release_date, territories, status, notes, ownership(artist_id, role, share_pct, territory)")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const { ownership, ...work } = data as typeof data & { ownership: OwnershipRow[] };
  return { ...work, owners: (ownership ?? []).map((o) => ({ ...o, share_pct: Number(o.share_pct) })) } as WorkDetail;
}

export async function getContracts(): Promise<ContractRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("contracts")
    .select("*, labels(name), artists(stage_name)")
    .order("effective_date", { ascending: false });
  fail(error);
  return (data ?? []).map((c) => ({
    ...c,
    commission_pct: Number(c.commission_pct),
    label_name: one<Named>(c.labels)?.name ?? null,
    artist_name: one<StageNamed>(c.artists)?.stage_name ?? null,
  })) as ContractRow[];
}

export async function getContract(id: string): Promise<ContractRow | null> {
  const sb = await createClient();
  const { data } = await sb.from("contracts").select("*, labels(name), artists(stage_name)").eq("id", id).maybeSingle();
  if (!data) return null;
  return {
    ...data,
    commission_pct: Number(data.commission_pct),
    label_name: one<Named>(data.labels)?.name ?? null,
    artist_name: one<StageNamed>(data.artists)?.stage_name ?? null,
  } as ContractRow;
}

const SUBMISSION_SELECT =
  "*, submitter:profiles!work_submissions_submitted_by_fkey(full_name, email), labels(name)";

function mapSubmission(s: Record<string, unknown>): SubmissionRow {
  const who = one<{ full_name: string | null; email: string } | null>(s.submitter);
  return {
    ...(s as unknown as SubmissionRow),
    writers: (s.writers as Writer[]) ?? [],
    submitter_name: who?.full_name ?? null,
    submitter_email: who?.email ?? null,
    label_name: one<Named>(s.labels)?.name ?? null,
  };
}

export async function getSubmissions(): Promise<SubmissionRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("work_submissions").select(SUBMISSION_SELECT).order("updated_at", { ascending: false });
  fail(error);
  return (data ?? []).map(mapSubmission);
}

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const sb = await createClient();
  const { data, error } = await sb.from("work_submissions").select(SUBMISSION_SELECT).eq("id", id).maybeSingle();
  fail(error);
  return data ? mapSubmission(data) : null;
}

/** Short-lived download links; storage rules decide who may open each file. */
export async function signedFileLinks(paths: string[]): Promise<{ path: string; name: string; url: string | null }[]> {
  if (!paths.length) return [];
  const sb = await createClient();
  const { data } = await sb.storage.from("work-submissions").createSignedUrls(paths, 60 * 30);
  return paths.map((p) => ({
    path: p,
    name: p.split("/").pop()?.replace(/^\d+-/, "") ?? p,
    url: data?.find((d) => d.path === p)?.signedUrl ?? null,
  }));
}

/** https://plutus-royalty.netlify.app — used to build invitation links. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "plutus-royalty.netlify.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// Session 3: royalty reports (uploads)
// ---------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  source: string;
  royalty_type: "publisher" | "admin_only";
  period_start: string;
  period_end: string;
  file_name: string | null;
  file_path: string | null;
  row_count: number;
  unmatched_count: number;
  total_gross: number;
  declared_total: number | null;
  status: string;
  distribution_code: string | null;
  published_at: string | null;
  created_at: string;
}

const REPORT_COLS =
  "id, source, royalty_type, period_start, period_end, file_name, file_path, row_count, unmatched_count, total_gross, declared_total, status, distribution_code, published_at, created_at";

const toReport = (r: Record<string, unknown>) =>
  ({
    ...r,
    total_gross: Number(r.total_gross ?? 0),
    declared_total: r.declared_total == null ? null : Number(r.declared_total),
  }) as ReportRow;

export async function getReports(limit = 200): Promise<ReportRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("royalty_reports").select(REPORT_COLS).order("created_at", { ascending: false }).limit(limit);
  fail(error);
  return (data ?? []).map(toReport);
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const sb = await createClient();
  const { data } = await sb.from("royalty_reports").select(REPORT_COLS).eq("id", id).maybeSingle();
  return data ? toReport(data) : null;
}

export interface ReportLine {
  id: string;
  work_title: string | null;
  raw_work_no: string | null;
  licensee: string | null;
  publisher_name: string | null;
  label_name: string | null;
  artist_name: string | null;
  gross_amount: number;
  commission_pct: number;
  commission_amount: number;
  net_payable: number;
  match_status: string;
  work_id: string | null;
}

export async function getReportLines(id: string): Promise<ReportLine[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("v_royalty_lines")
    .select("id, work_title, raw_work_no, licensee, publisher_name, label_name, artist_name, gross_amount, commission_pct, commission_amount, net_payable, match_status, work_id")
    .eq("report_id", id)
    .order("gross_amount", { ascending: false })
    .limit(5000);
  fail(error);
  return (data ?? []).map((l) => ({
    ...l,
    gross_amount: Number(l.gross_amount),
    commission_pct: Number(l.commission_pct),
    commission_amount: Number(l.commission_amount),
    net_payable: Number(l.net_payable),
  })) as ReportLine[];
}

export async function reportFileLink(path: string | null): Promise<string | null> {
  if (!path) return null;
  const sb = await createClient();
  const { data } = await sb.storage.from("royalty-reports").createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

export interface LabelMatchRow {
  id: string;
  name: string;
  aliases: string[];
}

export async function getLabelsWithAliases(): Promise<LabelMatchRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("labels").select("id, name, aliases").eq("is_active", true).order("name");
  fail(error);
  return (data ?? []) as LabelMatchRow[];
}

// ---------------------------------------------------------------------------
// Session 3: commission per client (dashboard panel)
// ---------------------------------------------------------------------------

export interface ClientCommission {
  kind: "label" | "artist";
  id: string;
  name: string;
  label_name: string | null;
  commission_pct: number;
  is_default: boolean;
  open_gross: number;
  open_commission: number;
}

export async function getClientCommissions(): Promise<{ defaultPct: number; clients: ClientCommission[] }> {
  const sb = await createClient();
  const [{ data: list, error }, { data: setting }] = await Promise.all([
    sb.rpc("client_commission_list"),
    sb.from("app_settings").select("value").eq("key", "default_commission_pct").maybeSingle(),
  ]);
  fail(error);
  return {
    defaultPct: Number(setting?.value ?? 15),
    clients: ((list ?? []) as ClientCommission[]).map((c) => ({
      ...c,
      commission_pct: Number(c.commission_pct),
      open_gross: Number(c.open_gross),
      open_commission: Number(c.open_commission),
    })),
  };
}
