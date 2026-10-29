"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, inputCls, type ActionState } from "@/components/forms";
import { saveContract } from "./actions";

type Opt = { id: string; name: string };

export interface ContractValues {
  id: string;
  label_id: string | null;
  artist_id: string | null;
  contract_type: string;
  commission_pct: number;
  effective_date: string;
  end_date: string | null;
  territories: string[];
  status: string;
  notes: string | null;
}

export function ContractForm({ contract, labels, artists }: { contract?: ContractValues; labels: Opt[]; artists: Opt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveContract.bind(null, contract?.id ?? null), undefined);
  const party = contract ? (contract.artist_id ? `artist:${contract.artist_id}` : `label:${contract.label_id}`) : "";
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Contract with" htmlFor="c-party" hint="A label-wide contract covers all its writers who have no personal contract." className="md:col-span-2">
        <select id="c-party" name="party" required defaultValue={party} className={inputCls}>
          <option value="">Choose</option>
          <optgroup label="Labels (label-wide)">
            {labels.map((l) => (
              <option key={l.id} value={`label:${l.id}`}>
                {l.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Rights holders (personal deal)">
            {artists.map((a) => (
              <option key={a.id} value={`artist:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      <Field label="Contract type" htmlFor="c-type">
        <select id="c-type" name="contract_type" defaultValue={contract?.contract_type ?? "publishing"} className={inputCls}>
          <option value="publishing">Publishing</option>
          <option value="co_publishing">Co-publishing</option>
          <option value="administration">Administration</option>
          <option value="sub_publishing">Sub-publishing</option>
          <option value="distribution">Distribution</option>
        </select>
      </Field>
      <Field label="Plutus commission %" htmlFor="c-pct" hint="Taken from publisher-collected royalties. Never from money paid directly.">
        <input id="c-pct" name="commission_pct" type="number" min="0" max="100" step="0.01" required defaultValue={contract?.commission_pct ?? ""} className={`${inputCls} num`} />
      </Field>
      <Field label="Effective from" htmlFor="c-from">
        <input id="c-from" name="effective_date" type="date" required defaultValue={contract?.effective_date ?? ""} className={inputCls} />
      </Field>
      <Field label="Ends on" htmlFor="c-to" hint="Leave empty if it has no end date">
        <input id="c-to" name="end_date" type="date" defaultValue={contract?.end_date ?? ""} className={inputCls} />
      </Field>
      <Field label="Territories" htmlFor="c-terr" hint="WORLD, or country codes like IN, GB, US">
        <input id="c-terr" name="territories" defaultValue={(contract?.territories ?? ["WORLD"]).join(", ")} className={inputCls} />
      </Field>
      <Field label="Status" htmlFor="c-status">
        <select id="c-status" name="status" defaultValue={contract?.status ?? "active"} className={inputCls}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
      </Field>
      <Field label="Notes" htmlFor="c-notes" className="md:col-span-2">
        <textarea id="c-notes" name="notes" rows={2} defaultValue={contract?.notes ?? ""} className={inputCls} />
      </Field>
      <div className="flex flex-col gap-3 md:col-span-2">
        <p className="text-sm text-ink-3">The commission applies to royalties imported after you save. Lines already imported keep the rate they were calculated with.</p>
        <FormMessage state={state} />
        <div className="flex gap-3">
          <SubmitButton>{contract ? "Save changes" : "Add contract"}</SubmitButton>
          <Link href={"/contracts"} className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-sunken">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
