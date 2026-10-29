"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import { registerSubmission, reviewSubmission } from "./actions";

export function ReviewForms({ id, status }: { id: string; status: string }) {
  const [rState, review] = useActionState<ActionState, FormData>(reviewSubmission.bind(null, id), undefined);
  const [gState, register] = useActionState<ActionState, FormData>(registerSubmission.bind(null, id), undefined);

  return (
    <div className="space-y-6">
      {status === "submitted" && (
        <form action={review}>
          <input type="hidden" name="status" value="under_review" />
          <p className="mb-2 text-sm text-ink-2">Tell the writer you have started work on it.</p>
          <SubmitButton tone="plain">Start review</SubmitButton>
        </form>
      )}

      <form action={register} className="space-y-3">
        <Field label="Registered with IPRS: enter the ISWC" htmlFor="rv-iswc" hint="Creates the work in the catalog with these writers and shares, and tells the writer.">
          <input id="rv-iswc" name="iswc" required placeholder="T-123.456.789-0" className={`${inputCls} num`} />
        </Field>
        <FormMessage state={gState} />
        <SubmitButton pendingText="Registering">Mark as registered</SubmitButton>
      </form>

      <form action={review} className="space-y-3 border-t border-line pt-5">
        <input type="hidden" name="status" value="needs_changes" />
        <Field label="Something to fix?" htmlFor="rv-note" hint="The writer sees this note and can edit and re-submit.">
          <textarea id="rv-note" name="reviewer_note" rows={3} className={inputCls} placeholder="Please add the lyricist's IPI number" />
        </Field>
        <FormMessage state={rState} />
        <SubmitButton tone="danger">Ask for changes</SubmitButton>
      </form>
    </div>
  );
}
