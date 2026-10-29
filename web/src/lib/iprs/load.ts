import type { Cell } from "./parse";

/** Excel cell value -> plain value (formulas give their result, rich text gives its text). */
function plain(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if ("result" in o) return plain(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.error) return null;
  }
  return String(v);
}

/**
 * Reads the first sheet of an .xlsx into rows of plain values.
 * IPRS files declare a wrong sheet size in their header, so every row is walked explicitly.
 */
export async function readFirstSheet(data: ArrayBuffer): Promise<{ sheetName: string; rows: Cell[][] }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The Excel file has no sheets.");
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const values = (row.values as unknown[]).slice(1).map(plain); // exceljs rows are 1-based
    rows[n - 1] = values;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return { sheetName: ws.name, rows };
}
