import { ComingSoon, PageTitle } from "@/components/ui";

export default async function Page() {
  return (
    <div>
      <PageTitle title="Statements" intro="Monthly, quarterly, annual and society-wise statements." />
      <ComingSoon session="Session 4" what="Download each statement as PDF or Excel. A statement shows the gross collected, Plutus commission and net payable, and lists royalties paid directly by societies separately." columns={["Period", "Statement type", "Society", "Gross", "Commission", "Net payable", "Paid directly", "PDF", "Excel"]} />
    </div>
  );
}
