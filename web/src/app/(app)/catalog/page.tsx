import { PageTitle, StatusChip } from "@/components/ui";
import { getCatalog } from "@/lib/data";
import { territoryName } from "@/lib/format";

const ROLE: Record<string, string> = {
  composer: "Composer",
  author: "Author",
  composer_author: "Composer & author",
  arranger: "Arranger",
  original_publisher: "Publisher",
  sub_publisher: "Sub-publisher",
  performer: "Performer",
};

export default async function CatalogPage() {
  const rows = await getCatalog();
  // group the ownership rows under each work
  const works = new Map<string, typeof rows>();
  rows.forEach((r) => works.set(r.work_id, [...(works.get(r.work_id) ?? []), r]));

  return (
    <div>
      <PageTitle
        title="Works & catalog"
        intro="Every song, its codes, and who owns which share. Ownership of one work always adds up to 100% or less."
      />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">Song title</th>
              <th className="px-3 py-2.5 font-medium">ISWC</th>
              <th className="px-3 py-2.5 font-medium">ISRC</th>
              <th className="px-3 py-2.5 font-medium">Rights holder and role</th>
              <th className="px-3 py-2.5 text-right font-medium">Ownership</th>
              <th className="px-3 py-2.5 font-medium">Territory</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {works.size === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-3">
                  No works yet. Add the first song to start matching royalties to it.
                </td>
              </tr>
            )}
            {[...works.values()].map((owners) =>
              owners.map((o, i) => (
                <tr key={`${o.work_id}-${i}`} className={i === owners.length - 1 ? "border-b border-line last:border-0" : ""}>
                  {i === 0 && (
                    <>
                      <td rowSpan={owners.length} className="px-4 py-2.5 align-top font-semibold">{o.title}</td>
                      <td rowSpan={owners.length} className="num px-3 py-2.5 align-top text-ink-2">{o.iswc ?? "Not assigned"}</td>
                      <td rowSpan={owners.length} className="num px-3 py-2.5 align-top text-ink-2">
                        {o.isrc?.length ? o.isrc.join(", ") : "None"}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2.5">
                    {o.artist_name ?? "No owner yet"}
                    {o.role && <span className="block text-xs text-ink-3">{ROLE[o.role] ?? o.role}</span>}
                  </td>
                  <td className="num px-3 py-2.5 text-right font-semibold">{o.share_pct != null ? `${Number(o.share_pct)}%` : "—"}</td>
                  {i === 0 && (
                    <>
                      <td rowSpan={owners.length} className="px-3 py-2.5 align-top">
                        {o.territories.map((t) => territoryName[t] ?? t).join(", ")}
                      </td>
                      <td rowSpan={owners.length} className="px-4 py-2.5 align-top">
                        <StatusChip status={o.status} />
                      </td>
                    </>
                  )}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
