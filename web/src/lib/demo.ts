// Demo data — used only while Supabase keys are not configured.
// Fictional names; the money rules match the database exactly
// (publisher: gross − contract commission; admin-only: no commission, paid directly).
import type {
  AppRole,
  BreakdownRow,
  CatalogRow,
  Kpis,
  NotificationRow,
  RoyaltyLine,
  Viewer,
} from "./types";

interface DemoArtist {
  id: string;
  name: string;
  label: string;
  commission: number;
}

const ARTISTS: DemoArtist[] = [
  { id: "a1", name: "Ravi Sharma", label: "Sunrise Records", commission: 15 },
  { id: "a2", name: "Meera Joshi", label: "Sunrise Records", commission: 20 },
  { id: "a3", name: "Kabir Khan", label: "Moonbeam Music", commission: 25 },
];

const WORKS: Record<string, string[]> = {
  a1: ["Saawan Ki Raat", "Dhoop Chhaon"],
  a2: ["Saawan Ki Raat", "Pehli Baarish"],
  a3: ["Neon Nights", "Shehar Ki Hawa"],
};

const QUARTERS: [string, string][] = [
  ["2025-04-01", "2025-06-30"],
  ["2025-07-01", "2025-09-30"],
  ["2025-10-01", "2025-12-31"],
  ["2026-01-01", "2026-03-31"],
];

// source, royalty type, territory, usage, base amount
const STREAMS: [string, "publisher" | "admin_only", string, string, number][] = [
  ["IPRS", "publisher", "IN", "performance", 9000],
  ["IPRS", "publisher", "IN", "mechanical", 3200],
  ["PRS", "admin_only", "GB", "performance", 4100],
  ["MCPS", "publisher", "GB", "mechanical", 1800],
  ["YouTube", "publisher", "IN", "streaming", 5200],
  ["Spotify", "publisher", "US", "streaming", 2600],
  ["ASCAP", "admin_only", "US", "performance", 1500],
];

function buildLines(): RoyaltyLine[] {
  const lines: RoyaltyLine[] = [];
  let n = 0;
  ARTISTS.forEach((a, ai) => {
    QUARTERS.forEach(([ps, pe], qi) => {
      STREAMS.forEach(([source, type, territory, usage, base], si) => {
        // deterministic variation so the numbers look real but never change
        const factor = 0.55 + ((ai * 7 + qi * 5 + si * 3) % 10) / 12;
        const gross = Math.round(base * factor * (1 + qi * 0.08));
        const pct = type === "publisher" ? a.commission : 0;
        const comm = Math.round((gross * pct) / 100 * 100) / 100;
        const isLatest = qi === QUARTERS.length - 1;
        const isUnmatched = isLatest && ai === 2 && si === 6;
        lines.push({
          id: `l${++n}`,
          royalty_type: type,
          source,
          territory,
          usage_type: usage,
          period_start: ps,
          period_end: pe,
          gross_amount: gross,
          commission_pct: pct,
          commission_amount: comm,
          net_payable: gross - comm,
          status:
            type === "admin_only" ? "paid_directly" : isLatest ? "pending" : "paid",
          match_status: isUnmatched ? "unmatched" : "matched",
          artist_name: a.name,
          label_name: a.label,
          work_title: isUnmatched ? null : WORKS[a.id][(qi + si) % 2],
        });
      });
    });
  });
  return lines;
}

const ALL_LINES = buildLines();

export const DEMO_VIEWERS: Record<AppRole, Viewer> = {
  super_admin: {
    id: "demo-admin",
    email: "admin@plutusmedia.demo",
    fullName: "Plutus Admin",
    role: "super_admin",
    labelName: null,
  },
  label_admin: {
    id: "demo-label",
    email: "label@sunrise.demo",
    fullName: "Sunrise Records",
    role: "label_admin",
    labelName: "Sunrise Records",
  },
  author_composer: {
    id: "demo-ravi",
    email: "ravi@writers.demo",
    fullName: "Ravi Sharma",
    role: "author_composer",
    labelName: "Sunrise Records",
  },
};

export function demoLines(role: AppRole): RoyaltyLine[] {
  if (role === "super_admin") return ALL_LINES;
  if (role === "label_admin") return ALL_LINES.filter((l) => l.label_name === "Sunrise Records");
  return ALL_LINES.filter((l) => l.artist_name === "Ravi Sharma");
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: RoyaltyLine[], f: (l: RoyaltyLine) => number) => r2(xs.reduce((s, l) => s + f(l), 0));

export function demoKpis(role: AppRole): Kpis {
  const v = demoLines(role);
  const pub = v.filter((l) => l.royalty_type === "publisher");
  const adm = v.filter((l) => l.royalty_type === "admin_only");
  const cur = v.reduce((m, l) => (l.period_start > m ? l.period_start : m), "");
  const curEnd = v.find((l) => l.period_start === cur)?.period_end ?? null;
  return {
    lifetime_gross: sum(pub, (l) => l.gross_amount),
    lifetime_commission: sum(pub, (l) => l.commission_amount),
    lifetime_net: sum(pub, (l) => l.net_payable),
    admin_only_lifetime: sum(adm, (l) => l.gross_amount),
    current_period_start: cur || null,
    current_period_end: curEnd,
    current_period_net: sum(pub.filter((l) => l.period_start === cur), (l) => l.net_payable),
    current_period_admin_only: sum(adm.filter((l) => l.period_start === cur), (l) => l.gross_amount),
    pending_net: sum(pub.filter((l) => ["pending", "approved", "on_hold"].includes(l.status)), (l) => l.net_payable),
    paid_net: sum(pub.filter((l) => l.status === "paid"), (l) => l.net_payable),
  };
}

export function demoBreakdown(role: AppRole, dim: "source" | "territory" | "month"): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const l of demoLines(role)) {
    const key = dim === "source" ? l.source : dim === "territory" ? l.territory : l.period_start.slice(0, 7);
    const row = map.get(key) ?? { bucket: key, publisher_gross: 0, commission: 0, publisher_net: 0, admin_only: 0 };
    if (l.royalty_type === "publisher") {
      row.publisher_gross += l.gross_amount;
      row.commission += l.commission_amount;
      row.publisher_net += l.net_payable;
    } else {
      row.admin_only += l.gross_amount;
    }
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, publisher_gross: r2(r.publisher_gross), commission: r2(r.commission), publisher_net: r2(r.publisher_net), admin_only: r2(r.admin_only) }))
    .sort((a, b) => b.publisher_gross + b.admin_only - (a.publisher_gross + a.admin_only));
}

export function demoCatalog(role: AppRole): CatalogRow[] {
  const rows: CatalogRow[] = [
    { work_id: "w1", title: "Saawan Ki Raat", iswc: "T-123.456.789-0", isrc: ["INABC2600001"], status: "registered", territories: ["WORLD"], artist_name: "Ravi Sharma", role: "composer", share_pct: 50 },
    { work_id: "w1", title: "Saawan Ki Raat", iswc: "T-123.456.789-0", isrc: ["INABC2600001"], status: "registered", territories: ["WORLD"], artist_name: "Meera Joshi", role: "author", share_pct: 50 },
    { work_id: "w2", title: "Dhoop Chhaon", iswc: "T-234.567.890-1", isrc: ["INABC2600003"], status: "registered", territories: ["WORLD"], artist_name: "Ravi Sharma", role: "composer_author", share_pct: 100 },
    { work_id: "w3", title: "Pehli Baarish", iswc: null, isrc: ["INABC2600002"], status: "submitted", territories: ["IN"], artist_name: "Meera Joshi", role: "composer_author", share_pct: 100 },
    { work_id: "w4", title: "Neon Nights", iswc: "T-987.654.321-0", isrc: ["GBXYZ2600001"], status: "registered", territories: ["WORLD"], artist_name: "Kabir Khan", role: "composer_author", share_pct: 100 },
    { work_id: "w5", title: "Shehar Ki Hawa", iswc: null, isrc: [], status: "draft", territories: ["GB", "IN"], artist_name: "Kabir Khan", role: "composer", share_pct: 60 },
  ];
  if (role === "super_admin") return rows;
  if (role === "label_admin") return rows.filter((r) => r.artist_name !== "Kabir Khan");
  const mine = new Set(rows.filter((r) => r.artist_name === "Ravi Sharma").map((r) => r.work_id));
  return rows.filter((r) => mine.has(r.work_id));
}

export function demoNotifications(role: AppRole): NotificationRow[] {
  const base: NotificationRow[] = [
    { id: "n1", type: "report_uploaded", title: "New IPRS royalties added", body: "Period Jan 2026 – Mar 2026", link: "/royalties", read_at: null, created_at: "2026-10-20T10:00:00Z" },
    { id: "n2", type: "statement_available", title: "Your quarterly statement is ready", body: "Jan – Mar 2026", link: "/statements", read_at: null, created_at: "2026-10-21T10:00:00Z" },
    { id: "n3", type: "payment_update", title: "Invoice PLT-2026-0001: paid", body: "Paid via NEFT", link: "/payments", read_at: "2026-10-22T10:00:00Z", created_at: "2026-10-22T09:00:00Z" },
  ];
  if (role === "super_admin") {
    return [
      { id: "n0", type: "data_mismatch", title: "Data mismatch: ASCAP Jan 2026", body: "1 of 3 lines could not be matched to a work", link: "/royalties?type=admin_only", read_at: null, created_at: "2026-10-23T10:00:00Z" },
      ...base.slice(0, 1),
    ];
  }
  return base;
}
