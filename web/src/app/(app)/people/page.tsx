import Link from "next/link";
import { CopyBox } from "@/components/forms";
import { PageTitle, Panel, StatusChip, Tabs } from "@/components/ui";
import { getArtists, getInvitations, getLabels, getProfiles, siteOrigin } from "@/lib/admin-data";
import { isDemo } from "@/lib/data";
import { dateLabel, roleLabel } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { revokeInvitation } from "./actions";
import { AccessForm, ArtistForm, InviteForm, LabelForm } from "./forms";

type SP = Promise<{ tab?: string; added?: string }>;

export default async function PeoplePage({ searchParams }: { searchParams: SP }) {
  const viewer = await requireRole("super_admin", "label_admin");
  const { tab: rawTab, added } = await searchParams;
  const isSuper = viewer.role === "super_admin";

  if (isDemo()) {
    return (
      <div>
        <PageTitle title="People & access" />
        <Panel>Connect the database to invite people. Demo mode has no real accounts.</Panel>
      </div>
    );
  }

  const tabs = [
    { key: "invite", label: "Invite", href: "/people?tab=invite" },
    { key: "users", label: "Who can sign in", href: "/people?tab=users" },
    { key: "holders", label: "Rights holders", href: "/people?tab=holders" },
    ...(isSuper ? [{ key: "labels", label: "Labels", href: "/people?tab=labels" }] : []),
  ];
  const tab = tabs.some((t) => t.key === rawTab) ? rawTab! : "invite";

  const [labels, artists] = await Promise.all([getLabels(), getArtists()]);
  const labelOpts = labels.map((l) => ({ id: l.id, name: l.name }));

  return (
    <div>
      <PageTitle
        title="People & access"
        intro={
          isSuper
            ? "Invite writers, composers and label teams, decide what each person can see, and keep the list of rights holders."
            : `Invite the writers of ${viewer.labelName ?? "your label"} and keep their details up to date.`
        }
      />
      <Tabs tabs={tabs} current={tab} />

      {tab === "invite" && <InviteTab isSuper={isSuper} labels={labelOpts} artists={artists} />}
      {tab === "users" && <UsersTab isSuper={isSuper} labels={labelOpts} />}
      {tab === "holders" && <HoldersTab isSuper={isSuper} labels={labelOpts} artists={artists} added={added} />}
      {tab === "labels" && isSuper && <LabelsTab labels={labels} />}
    </div>
  );
}

async function InviteTab({
  isSuper,
  labels,
  artists,
}: {
  isSuper: boolean;
  labels: { id: string; name: string }[];
  artists: Awaited<ReturnType<typeof getArtists>>;
}) {
  const [invites, origin] = await Promise.all([getInvitations(), siteOrigin()]);
  const unlinked = artists.filter((a) => !a.user_id && a.is_active);

  return (
    <div className="space-y-6">
      <Panel
        title="Invite someone"
        note="You get a private link. Send it to the person on WhatsApp or email; they open it and choose their own password."
      >
        <InviteForm
          viewerRole={isSuper ? "super_admin" : "label_admin"}
          labels={labels}
          artists={unlinked.map((a) => ({ id: a.id, name: `${a.stage_name}${a.label_name ? ` · ${a.label_name}` : ""}` }))}
        />
      </Panel>

      <Panel title="Invitations" note="Links stay valid for 14 days and work only once, only with the invited email.">
        {invites.length === 0 ? (
          <p className="text-ink-3">No invitations yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((i) => {
              const status = i.accepted_at
                ? "invite_accepted"
                : i.revoked_at
                  ? "invite_revoked"
                  : i.is_expired
                    ? "invite_expired"
                    : "invite_open";
              return (
                <li key={i.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-semibold">{i.full_name || i.email}</p>
                    <StatusChip status={status} />
                    <p className="text-sm text-ink-3">
                      {i.email} · {roleLabel[i.role]}
                      {i.label_name ? ` · ${i.label_name}` : ""}
                      {i.artist_name ? ` · linked to ${i.artist_name}` : ""} · sent {dateLabel(i.created_at)}
                    </p>
                  </div>
                  {status === "invite_open" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <CopyBox value={`${origin}/join/${i.token}`} />
                      </div>
                      <form action={revokeInvitation.bind(null, i.id)}>
                        <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-bad hover:bg-sunken">
                          Revoke
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

async function UsersTab({ isSuper, labels }: { isSuper: boolean; labels: { id: string; name: string }[] }) {
  const people = await getProfiles();
  return (
    <Panel
      note={
        isSuper
          ? "Change a role, move someone to another label, or switch an account off. Switched-off people cannot sign in."
          : "People of your label who can sign in. Ask Plutus to change a role or switch an account off."
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Last sign-in</th>
              <th className="px-3 py-2 font-medium">{isSuper ? "Role, label and access" : "Role"}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-line align-top last:border-0">
                <td className="py-3 pr-3">
                  <p className="font-semibold">{p.full_name || p.email}</p>
                  <p className="text-ink-3">{p.email}</p>
                </td>
                <td className="px-3 py-3 text-ink-2">{p.last_login_at ? dateLabel(p.last_login_at) : "Never"}</td>
                <td className="px-3 py-3">
                  {isSuper ? (
                    <AccessForm userId={p.id} role={p.role} labelId={p.label_id} isActive={p.is_active} labels={labels} />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{roleLabel[p.role]}</span>
                      <StatusChip status={p.is_active ? "user_on" : "user_off"} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function HoldersTab({
  isSuper,
  labels,
  artists,
  added,
}: {
  isSuper: boolean;
  labels: { id: string; name: string }[];
  artists: Awaited<ReturnType<typeof getArtists>>;
  added?: string;
}) {
  const addedName = added ? artists.find((a) => a.id === added)?.stage_name : null;
  return (
    <div className="space-y-6">
      <Panel title="Rights holders" note="Writers, composers and artists whose works and royalties Plutus tracks.">
        {addedName && (
          <p role="status" className="mb-4 rounded-md border border-ok/40 bg-sunken px-3 py-2 text-sm text-ok">
            {addedName} added. You can now add them to works or invite them to sign in.
          </p>
        )}
        {artists.length === 0 ? (
          <p className="text-ink-3">No rights holders yet. Add the first one below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">IPI</th>
                  <th className="px-3 py-2 font-medium">Society</th>
                  {isSuper && <th className="px-3 py-2 font-medium">Label</th>}
                  <th className="px-3 py-2 font-medium">Login</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {artists.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold">{a.stage_name}</p>
                      {a.email && <p className="text-ink-3">{a.email}</p>}
                    </td>
                    <td className="num px-3 py-2.5 text-ink-2">{a.ipi_number ?? "—"}</td>
                    <td className="px-3 py-2.5 text-ink-2">{a.society ?? "—"}</td>
                    {isSuper && <td className="px-3 py-2.5 text-ink-2">{a.label_name ?? "Independent"}</td>}
                    <td className="px-3 py-2.5">
                      {a.user_id ? <StatusChip status="user_on" /> : <span className="text-ink-3">Not invited</span>}
                      {!a.is_active && <span className="ml-2 text-xs text-ink-3">(inactive)</span>}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <Link href={`/people/holders/${a.id}`} className="font-semibold text-brand hover:underline">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Add a rights holder">
        <ArtistForm viewerRole={isSuper ? "super_admin" : "label_admin"} labels={labels} />
      </Panel>
    </div>
  );
}

function LabelsTab({ labels }: { labels: Awaited<ReturnType<typeof getLabels>> }) {
  return (
    <div className="space-y-6">
      <Panel title="Labels" note="Record labels and publishers that are Plutus clients.">
        {labels.length === 0 ? (
          <p className="text-ink-3">No labels yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {labels.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="font-semibold">{l.name}</span>
                <span className="text-sm text-ink-3">{l.contact_email ?? "No contact email"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Add a label">
        <LabelForm />
      </Panel>
    </div>
  );
}
