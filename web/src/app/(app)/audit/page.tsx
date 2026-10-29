import { ComingSoon, PageTitle } from "@/components/ui";
import { requireRole } from "@/lib/guard";

export default async function Page() {
  await requireRole("super_admin");
  return (
    <div>
      <PageTitle title="Audit log" intro="Uploads, edits, sign-ins, downloads and payment approvals. Entries cannot be edited." />
      <ComingSoon session="Session 6" what="Every change is recorded with who made it and when, along with the before and after values." columns={["When", "Who", "Action", "Record", "Before", "After", "IP address"]} />
    </div>
  );
}
