"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import { acceptInvitation } from "../actions";

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(acceptInvitation.bind(null, token), undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="Email" htmlFor="join-email">
        <input id="join-email" value={email} readOnly disabled className={inputCls} autoComplete="username" />
      </Field>
      <Field label="Choose a password" htmlFor="join-pw" hint="At least 8 characters.">
        <input id="join-pw" name="password" type="password" minLength={8} required autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="Type it again" htmlFor="join-pw2">
        <input id="join-pw2" name="confirm" type="password" minLength={8} required autoComplete="new-password" className={inputCls} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full py-2.5" pendingText="Creating your account">
        Create my account
      </SubmitButton>
    </form>
  );
}
