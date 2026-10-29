import { ComingSoon, PageTitle } from "@/components/ui";
import { requireRole } from "@/lib/guard";

export default async function Page() {
  await requireRole("super_admin", "label_admin");
  return (
    <div>
      <PageTitle title="People & access" intro="Who can sign in and what they can see." />
      <ComingSoon session="Session 2" what="Invite label admins and rights holders, link them to artists, require 2FA, and restrict sign-in to office IP addresses." columns={["Name", "Email", "Role", "Label", "2FA", "IP restriction", "Last sign-in", "Status"]} />
    </div>
  );
}
