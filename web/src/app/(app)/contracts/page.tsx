import { ComingSoon, PageTitle } from "@/components/ui";

export default async function Page() {
  return (
    <div>
      <PageTitle title="Contracts" intro="Your commission terms. Read-only: contact Plutus to change a contract." />
      <ComingSoon session="Session 2" what="See which contract applies, its commission and the territories it covers." columns={["Contract type", "Commission %", "Effective date", "End date", "Territory coverage", "Status"]} />
    </div>
  );
}
