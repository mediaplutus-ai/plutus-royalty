"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import type { AppRole } from "@/lib/types";
import { createInvitation, createLabel, saveArtist, updateAccess } from "./actions";

type Opt = { id: string; name: string; labelId?: string | null };

const ROLE_TEXT: Record<AppRole, string> = {
  author_composer: "Author / Composer (sees only own earnings and works)",
  label_admin: "Label Admin (sees everything of one label)",
  super_admin: "Super Admin (Plutus team, sees everything)",
};

export function InviteForm({
  viewerRole,
  labels,
  artists,
}: {
  viewerRole: AppRole;
  labels: Opt[];
  artists: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createInvitation, undefined);
  const [role, setRole] = useState<AppRole>("author_composer");
  const isSuper = viewerRole === "super_admin";

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Email" htmlFor="inv-email">
        <input id="inv-email" name="email" type="email" required className={inputCls} placeholder="writer@example.com" />
      </Field>
      <Field label="Name" htmlFor="inv-name">
        <input id="inv-name" name="full_name" className={inputCls} placeholder="As it should appear on the dashboard" />
      </Field>
      {isSuper ? (
        <Field label="Role" htmlFor="inv-role">
          <select id="inv-role" name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)} className={inputCls}>
            {(Object.keys(ROLE_TEXT) as AppRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_TEXT[r]}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="role" value="author_composer" />
      )}
      {isSuper && role !== "super_admin" && (
        <Field label="Label" htmlFor="inv-label" hint={role === "label_admin" ? "Required for a Label Admin." : "Optional for a writer."}>
          <select id="inv-label" name="label_id" className={inputCls} required={role === "label_admin"} defaultValue="">
            <option value="">{role === "label_admin" ? "Choose a label" : "No label (independent writer)"}</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {role === "author_composer" && (
        <Field
          label="Link to rights holder"
          htmlFor="inv-artist"
          hint="Their earnings and works appear after they join. Add the rights holder first if they are not in the list."
        >
          <select id="inv-artist" name="artist_id" className={inputCls} defaultValue="">
            <option value="">Match by email automatically</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex flex-col gap-3 md:col-span-2">
        <FormMessage state={state} />
        <div>
          <SubmitButton pendingText="Creating link">Create invitation link</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function AccessForm({
  userId,
  role,
  labelId,
  isActive,
  labels,
}: {
  userId: string;
  role: AppRole;
  labelId: string | null;
  isActive: boolean;
  labels: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateAccess.bind(null, userId), undefined);
  const [r, setR] = useState<AppRole>(role);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${userId}`}>
        Role
      </label>
      <select id={`role-${userId}`} name="role" value={r} onChange={(e) => setR(e.target.value as AppRole)} className={`${inputCls} w-auto py-1 text-sm`}>
        <option value="author_composer">Author / Composer</option>
        <option value="label_admin">Label Admin</option>
        <option value="super_admin">Super Admin</option>
      </select>
      {r !== "super_admin" && (
        <>
          <label className="sr-only" htmlFor={`label-${userId}`}>
            Label
          </label>
          <select id={`label-${userId}`} name="label_id" defaultValue={labelId ?? ""} className={`${inputCls} w-auto py-1 text-sm`}>
            <option value="">No label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={isActive} className="h-4 w-4" />
        Can sign in
      </label>
      <SubmitButton tone="plain" className="py-1">
        Save
      </SubmitButton>
      {state?.error && <span className="w-full text-sm text-bad">{state.error}</span>}
      {state?.ok && <span className="text-sm text-ok">{state.ok}</span>}
    </form>
  );
}

export function LabelForm() {
  const [state, action] = useActionState<ActionState, FormData>(createLabel, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Label name" htmlFor="lb-name">
        <input id="lb-name" name="name" required className={inputCls} />
      </Field>
      <Field label="Legal name" htmlFor="lb-legal">
        <input id="lb-legal" name="legal_name" className={inputCls} />
      </Field>
      <Field label="Contact email" htmlFor="lb-email">
        <input id="lb-email" name="contact_email" type="email" className={inputCls} />
      </Field>
      <Field label="Contact phone" htmlFor="lb-phone">
        <input id="lb-phone" name="contact_phone" className={inputCls} />
      </Field>
      <Field label="GSTIN" htmlFor="lb-gst" hint="Optional">
        <input id="lb-gst" name="gstin" className={inputCls} />
      </Field>
      <div className="flex flex-col gap-3 md:col-span-2">
        <FormMessage state={state} />
        <div>
          <SubmitButton>Add label</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function ArtistForm({
  artist,
  viewerRole,
  labels,
}: {
  artist?: {
    id: string;
    stage_name: string;
    legal_name: string | null;
    email: string | null;
    phone: string | null;
    ipi_number: string | null;
    society: string | null;
    label_id: string | null;
    is_active: boolean;
  };
  viewerRole: AppRole;
  labels: Opt[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveArtist.bind(null, artist?.id ?? null), undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Known as" htmlFor="ar-stage" hint="Name used on the dashboard and statements">
        <input id="ar-stage" name="stage_name" required defaultValue={artist?.stage_name} className={inputCls} />
      </Field>
      <Field label="Legal name" htmlFor="ar-legal">
        <input id="ar-legal" name="legal_name" defaultValue={artist?.legal_name ?? ""} className={inputCls} />
      </Field>
      <Field label="Email" htmlFor="ar-email" hint="Used to link their login automatically">
        <input id="ar-email" name="email" type="email" defaultValue={artist?.email ?? ""} className={inputCls} />
      </Field>
      <Field label="Phone" htmlFor="ar-phone">
        <input id="ar-phone" name="phone" defaultValue={artist?.phone ?? ""} className={inputCls} />
      </Field>
      <Field label="IPI number" htmlFor="ar-ipi" hint="CAE/IPI from IPRS or PRS">
        <input id="ar-ipi" name="ipi_number" defaultValue={artist?.ipi_number ?? ""} className={`${inputCls} num`} />
      </Field>
      <Field label="Society" htmlFor="ar-society" hint="IPRS, PRS, ASCAP…">
        <input id="ar-society" name="society" defaultValue={artist?.society ?? "IPRS"} className={inputCls} />
      </Field>
      {viewerRole === "super_admin" && (
        <Field label="Label" htmlFor="ar-label">
          <select id="ar-label" name="label_id" defaultValue={artist?.label_id ?? ""} className={inputCls}>
            <option value="">No label (independent)</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {artist && (
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={artist.is_active} className="h-4 w-4" />
          Active rights holder
        </label>
      )}
      <div className="flex flex-col gap-3 md:col-span-2">
        <FormMessage state={state} />
        <div>
          <SubmitButton>{artist ? "Save changes" : "Add rights holder"}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
