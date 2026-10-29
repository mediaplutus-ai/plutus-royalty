import { ComingSoon, PageTitle } from "@/components/ui";

export default async function Page() {
  return (
    <div>
      <PageTitle title="Payments & invoices" intro="Every invoice and its payment status." />
      <ComingSoon session="Session 5" what="Track each invoice from approval to payment, with GST and TDS when they apply." columns={["Invoice no.", "Period", "Amount", "GST", "TDS", "Payable", "Status", "Payment mode", "Transaction ID"]} />
    </div>
  );
}
