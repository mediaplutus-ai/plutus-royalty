import Link from "next/link";
import { Suspense } from "react";
import { roleLabel } from "@/lib/format";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { JoinForm } from "./JoinForm";

type Params = Promise<{ token: string }>;

export default function JoinPage({ params }: { params: Params }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-2xl font-extrabold tracking-tight">
          Plutus<span className="text-brand">.</span>
        </p>
        <Suspense fallback={<p className="text-ink-3">Checking your invitation</p>}>
          <JoinBody params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function JoinBody({ params }: { params: Params }) {
  const { token } = await params;
  if (!supabaseConfigured()) {
    return <p className="text-ink-2">Invitations work once the database is connected.</p>;
  }
  const sb = await createClient();
  const { data } = await sb.rpc("invitation_preview", { p_token: token });
  const inv = (Array.isArray(data) ? data[0] : data) as
    | { email: string; full_name: string | null; role: string; label_name: string | null; is_valid: boolean }
    | undefined;

  if (!inv || !inv.is_valid) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">This link does not work</h1>
        <p className="mt-2 text-ink-2">
          The invitation has expired, was already used, or was cancelled. Ask Plutus Media to send you a new link.
        </p>
        <Link href="/login" className="mt-6 inline-block font-semibold text-brand hover:underline">
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">
        Welcome{inv.full_name ? `, ${inv.full_name}` : ""}
      </h1>
      <p className="mt-2 text-ink-2">
        Plutus Media invited you as {roleLabel[inv.role] ?? inv.role}
        {inv.label_name ? ` for ${inv.label_name}` : ""}. Choose a password to see your royalties, works and statements.
      </p>
      <JoinForm token={token} email={inv.email} />
      <p className="mt-6 text-sm text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
