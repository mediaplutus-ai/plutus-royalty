export type AppRole = "super_admin" | "label_admin" | "author_composer";
export type RoyaltyType = "publisher" | "admin_only";
export type RoyaltyStatus =
  | "pending"
  | "approved"
  | "on_hold"
  | "disputed"
  | "paid"
  | "paid_directly";

export interface Viewer {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  labelName?: string | null;
  labelId?: string | null;
}

export interface Kpis {
  lifetime_gross: number;
  lifetime_commission: number;
  lifetime_net: number;
  admin_only_lifetime: number;
  current_period_start: string | null;
  current_period_end: string | null;
  current_period_net: number;
  current_period_admin_only: number;
  pending_net: number;
  paid_net: number;
  /** Plutus commission on royalties paid directly to rights holders (to invoice). */
  admin_only_fee: number;
  admin_only_fee_open: number;
}

export interface BreakdownRow {
  bucket: string;
  publisher_gross: number;
  commission: number;
  publisher_net: number;
  admin_only: number;
}

export interface RoyaltyLine {
  id: string;
  royalty_type: RoyaltyType;
  source: string;
  territory: string;
  usage_type: string | null;
  period_start: string;
  period_end: string;
  gross_amount: number;
  commission_pct: number;
  commission_amount: number;
  net_payable: number;
  status: RoyaltyStatus;
  match_status: "matched" | "unmatched" | "manual";
  artist_name: string | null;
  label_name: string | null;
  work_title: string | null;
  licensee?: string | null;
  distribution_code?: string | null;
}

export interface CatalogRow {
  work_id: string;
  title: string;
  iswc: string | null;
  isrc: string[];
  status: string;
  territories: string[];
  artist_name: string | null;
  role: string | null;
  share_pct: number | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface RoyaltyFilters {
  q?: string;
  licensee?: string;
  territory?: string;
  client?: string;
  year?: string;
  status?: string;
}
