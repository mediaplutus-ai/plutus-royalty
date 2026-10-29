/**
 * IPRS member statement reader (Excel exported by IPRS, e.g. "P2525A003~4228747~PLUTUS MEDIA.xlsx").
 *
 * Layout (checked against 61 real statements):
 *   rows 1-2 : member INTERNAL NO / IPI NAME NO / NAME / IPI BASE NO
 *   header   : WORK INT NO | TITLE | AV | LANGUAGE | NAME | ROLE | SOCIETY | OWN | COLL | POOL | SOURCE | ROYALTY AMT
 *              (foreign-society files: … | COLL | RADIO | TV | CINEMAS | PERMITS | DEMAND | GENERAL | OTHERS | ROYALTY AMT)
 *   body     : one block per work. First row has the work number, title and language; every row is one
 *              interested party (C/A/CA writers, E original publisher, SE sub-publisher). Money sits on the
 *              member's own SE rows, one row per SOURCE (licensee). A subtotal row closes each block.
 *   footer   : per POOL/SOURCE totals and the grand total (last numeric value of the last numeric row).
 *
 * Pure function: give it the sheet as an array of rows (arrays of cell values) — no file APIs here,
 * so the same code runs in the browser and in tests.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface IprsLine {
  workNo: string;
  title: string;
  language: string | null;
  /** Original publisher (ROLE E) that owns the share this money comes from — the Plutus client. */
  publisher: string | null;
  /** Name on the money row (the member, e.g. PLUTUS MEDIA). */
  payee: string;
  role: string;
  collPct: number | null;
  /** Licensee / platform, e.g. SPOTIFY AB, AIRTEL, PLUTUS MEDIA-OCT. Foreign files: the society name. */
  licensee: string | null;
  /** IPRS pool, e.g. INTERNET WEBSITE. */
  pool: string | null;
  amount: number;
  /** Raw breakdown for foreign-society files (RADIO, TV, …). */
  breakdown?: Record<string, number>;
}

export interface IprsStatement {
  memberNo: string | null;
  memberIpi: string | null;
  memberName: string | null;
  layout: "domestic" | "foreign";
  sheetName: string;
  /** From the file name, e.g. P2525 (distribution) and A003 (version). */
  distributionCode: string | null;
  /** 2-digit year in the distribution code -> 4-digit year (P25xx -> 2025). */
  year: number | null;
  /** Foreign society in the file name, e.g. "035 GEMA". */
  foreignSociety: string | null;
  works: number;
  lines: IprsLine[];
  lineTotal: number;
  footerTotal: number | null;
  /** Rows with money that are not on the member's own name (should be none). */
  otherPayees: string[];
}

const text = (v: Cell) => (v == null ? "" : String(v).trim());
const num = (v: Cell) => (typeof v === "number" ? v : v == null || v === "" ? 0 : Number(String(v).replace(/,/g, "")) || 0);
/** "PLUTUS MEDIA,  " / "LOVE KUMAR, SHARMA" -> "PLUTUS MEDIA" / "LOVE KUMAR SHARMA" */
export const cleanName = (v: Cell) =>
  text(v)
    .replace(/,\s*$/, "")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.match(/P(\d{2})(\d{2})(A\d{3})?/i);
  const foreign = base.match(/-\s*(\d{3}\s+[A-Z][A-Z0-9 ]*)$/i);
  return {
    distributionCode: m ? `P${m[1]}${m[2]}${m[3] ? m[3].toUpperCase() : ""}` : null,
    year: m ? 2000 + Number(m[1]) : null,
    foreignSociety: foreign ? foreign[1].trim().toUpperCase() : null,
  };
}

export function parseIprsRows(rows: Cell[][], fileName: string, sheetName = ""): IprsStatement {
  const headerAt = rows.findIndex((r) => text(r?.[0]).toUpperCase() === "WORK INT NO");
  if (headerAt < 0) throw new Error("This does not look like an IPRS member statement: the WORK INT NO column was not found.");

  const header = rows[headerAt].map((c) => text(c).toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const C = {
    no: col("WORK INT NO"),
    title: col("TITLE"),
    lang: col("LANGUAGE"),
    name: col("NAME"),
    role: col("ROLE"),
    coll: col("COLL"),
    pool: col("POOL"),
    source: col("SOURCE"),
    amt: col("ROYALTY AMT"),
  };
  if (C.name < 0 || C.role < 0 || C.amt < 0) throw new Error("IPRS statement is missing the NAME, ROLE or ROYALTY AMT column.");
  const breakdownCols = ["RADIO", "TV", "CINEMAS", "PERMITS", "DEMAND", "GENERAL", "OTHERS"].filter((h) => col(h) >= 0);
  const layout: IprsStatement["layout"] = C.source >= 0 ? "domestic" : "foreign";

  // member details from the rows above the header
  let memberNo: string | null = null;
  let memberIpi: string | null = null;
  let memberName: string | null = null;
  for (const r of rows.slice(0, headerAt)) {
    for (let i = 0; i < (r?.length ?? 0) - 1; i++) {
      const k = text(r[i]).toUpperCase();
      if (k === "INTERNAL NO") memberNo = text(r[i + 1]).replace(/\.0$/, "");
      if (k === "IPI NAME NO") memberIpi = text(r[i + 1]);
      if (k === "NAME") memberName = cleanName(r[i + 1]);
    }
  }
  const memberKey = (memberName ?? "").toUpperCase();
  const { distributionCode, year, foreignSociety } = parseFileName(fileName);

  const lines: IprsLine[] = [];
  const otherPayees = new Set<string>();
  let works = 0;
  let cur: { workNo: string; title: string; language: string | null } | null = null;
  let lastPublisher: string | null = null;
  let bodyEnd = rows.length;

  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = r[C.no];
    // the footer starts with a text label in the first column (POOL name / "POOL")
    if (typeof first === "string" && first.trim() !== "" && !/^\d+(\.0)?$/.test(first.trim())) {
      bodyEnd = i;
      break;
    }
    if (first !== null && first !== undefined && first !== "" && !Number.isNaN(Number(first))) {
      works++;
      cur = {
        workNo: String(Math.round(Number(first))),
        title: text(r[C.title]),
        language: text(r[C.lang]) || null,
      };
      lastPublisher = null;
    }
    const name = cleanName(r[C.name]);
    const role = text(r[C.role]).toUpperCase();
    if (!cur || !name || !role) continue;

    if (role === "E") lastPublisher = name;
    const amount = num(r[C.amt]);
    if (!amount) continue;

    if (memberKey && !name.toUpperCase().startsWith(memberKey)) otherPayees.add(name);
    const line: IprsLine = {
      workNo: cur.workNo,
      title: cur.title,
      language: cur.language,
      publisher: lastPublisher,
      payee: name,
      role,
      collPct: C.coll >= 0 ? num(r[C.coll]) : null,
      licensee: layout === "domestic" ? text(r[C.source]) || null : foreignSociety,
      pool: C.pool >= 0 ? text(r[C.pool]) || null : null,
      amount,
    };
    if (breakdownCols.length) {
      line.breakdown = Object.fromEntries(breakdownCols.map((h) => [h, num(r[col(h)])]));
    }
    lines.push(line);
  }

  // grand total = last number on the last row that has numbers
  let footerTotal: number | null = null;
  for (let i = rows.length - 1; i >= bodyEnd; i--) {
    const nums = (rows[i] ?? []).filter((c): c is number => typeof c === "number");
    if (nums.length) {
      footerTotal = nums[nums.length - 1];
      break;
    }
  }

  const lineTotal = lines.reduce((t, l) => t + l.amount, 0);
  return {
    memberNo,
    memberIpi,
    memberName,
    layout,
    sheetName,
    distributionCode,
    year,
    foreignSociety,
    works,
    lines,
    lineTotal,
    footerTotal,
    otherPayees: [...otherPayees],
  };
}

/** Same normalisation in the browser and the database: matches "FATAFAT DIGITAL PVT LTD" to "Fatafat Digital Private Limited". */
export function normName(v: string | null | undefined): string {
  return (v ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bPRIVATE\b/g, "PVT")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(PVT LTD|LTD|LLP|PVT|INC|CO)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
