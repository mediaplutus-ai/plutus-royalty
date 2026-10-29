import { Suspense } from "react";
import { supabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

type SP = Promise<{ next?: string; error?: string }>;

export default function LoginPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-nav p-12 text-white md:flex">
        <p className="text-2xl font-extrabold tracking-tight">
          Plutus<span className="text-[#8c9bff]">.</span>
        </p>
        <div className="max-w-md">
          <p className="text-[2.1rem] font-extrabold leading-tight tracking-tight">
            Every rupee, from the society to your account.
          </p>
          <p className="mt-4 text-nav-ink">
            See what each society and platform paid, what Plutus kept as commission, and when your money is sent.
            Royalties paid to you directly are tracked too.
          </p>
          <div className="mt-8 flex h-3 max-w-sm gap-[2px]" aria-hidden>
            <span className="w-[62%] rounded-l-[3px] bg-[#7584e0]" />
            <span className="w-[13%] bg-[#26a69a]" />
            <span className="w-[25%] rounded-r-[3px] bg-[#cc7f2e]" />
          </div>
        </div>
        <p className="text-sm text-nav-ink">Plutus Media, music publishing administration</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="mb-8 text-2xl font-extrabold tracking-tight md:hidden">Plutus.</p>
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-ink-2">Use the email Plutus invited you with.</p>
          <Suspense fallback={<LoginForm next="/dashboard" />}>
            <LoginBody searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function LoginBody({ searchParams }: { searchParams: SP }) {
  const { next, error } = await searchParams;
  return (
    <>
      {error === "inactive" && (
        <p className="mt-4 rounded-md border border-bad/40 bg-surface px-3 py-2 text-sm text-bad">
          This account is switched off. Ask Plutus Media to turn it back on.
        </p>
      )}
      {!supabaseConfigured() && (
        <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          Demo mode: the database is not connected yet, so any email opens the demo dashboard.
        </p>
      )}
      <LoginForm next={next ?? "/dashboard"} />
    </>
  );
}
