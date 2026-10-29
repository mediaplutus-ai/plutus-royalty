import { ComingSoon, PageTitle } from "@/components/ui";
import { requireRole } from "@/lib/guard";

export default async function Page() {
  await requireRole("super_admin");
  return (
    <div>
      <PageTitle title="Report uploads" intro="Upload society and platform statements; check matching before money is shown to clients." />
      <ComingSoon session="Session 3" what="Upload an IPRS, PRS, MCPS or platform file. The system matches each line to a work by ISWC, ISRC or title, applies the right commission, and flags anything that does not add up." columns={["File", "Source", "Royalty type", "Period", "Lines", "Not matched", "Total", "Status", "Uploaded by"]} />
    </div>
  );
}
