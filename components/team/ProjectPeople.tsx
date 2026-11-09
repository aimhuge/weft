"use client";

// "People on your projects": the GitHub collaborators of the team's linked repos, and the members of its GitHub org
// when it was made from one, each with an Invite button.
// A known public email invites straight away (the server adds an existing Weft account or emails an invite);
// otherwise a small email field comes first. Short by design: five rows, then "Show all N".
import { useEffect, useState, useTransition } from "react";
import { call } from "@/lib/client-api";
import type { CollaboratorsResult, GithubPerson } from "@/lib/github-collaborators";
import { looksLikeEmail, suggestPeople, visiblePeople } from "@/lib/team-people";
import type { RoleOption, TeamClientActions } from "@/lib/team-types";

type Message = { ok: boolean; text: string };

function PersonRow({ person, org, actions, roleOptions }: { person: GithubPerson; org?: string; actions: TeamClientActions; roleOptions: RoleOption[] }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, startTransition] = useTransition();
  const role = roleOptions.find((o) => o.role === "member")?.role ?? roleOptions[0]?.role ?? "member";

  function send(email: string) {
    startTransition(async () => {
      const result = await actions.invite(email, role);
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Invited." : "Couldn't invite.") });
      if (result.ok) setAsking(false);
    });
  }

  function invite() {
    if (person.email) send(person.email);
    else setAsking(true);
  }

  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "4px 0" }}>
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" width={20} height={20} style={{ borderRadius: "50%" }} />
      ) : null}
      <span style={{ fontWeight: 500 }}>{person.login}</span>
      <span style={{ opacity: 0.6, fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {person.repos.length > 0 ? person.repos.join(", ") : org ? `in ${org}` : ""}
      </span>
      {asking ? (
        <form
          style={{ display: "flex", gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (looksLikeEmail(typed)) send(typed.trim());
          }}
        >
          <input
            type="email"
            aria-label={`Email for ${person.login}`}
            className="wz-inviteInput"
            placeholder="their email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="wz-inviteSubmit" disabled={busy || !looksLikeEmail(typed)}>
            {busy ? "Sending…" : "Send"}
          </button>
        </form>
      ) : (
        <button type="button" className="wz-inviteSubmit" onClick={invite} disabled={busy}>
          {busy ? "Sending…" : "Invite"}
        </button>
      )}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`wz-inviteMessage ${message.ok ? "wz-inviteMessageOk" : "wz-inviteMessageError"}`} style={{ flexBasis: "100%", margin: 0 }}>
          {message.text}
        </p>
      ) : null}
    </li>
  );
}

export function ProjectPeople({
  repos,
  org,
  members,
  pending,
  actions,
  roleOptions,
}: {
  repos: string[];
  org?: string;
  members: { email: string | null; login?: string | null }[];
  pending: { email: string }[];
  actions: TeamClientActions;
  roleOptions: RoleOption[];
}) {
  const [result, setResult] = useState<CollaboratorsResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const key = repos.join(",");
  const query = `repos=${encodeURIComponent(key)}${org ? `&org=${encodeURIComponent(org)}` : ""}`;

  useEffect(() => {
    if (!key && !org) return;
    let live = true;
    call<CollaboratorsResult>("GET", `/api/github/collaborators?${query}`)
      .then((r) => live && setResult(r))
      .catch((err: unknown) => live && setResult({ people: [], error: (err as Error).message }));
    return () => {
      live = false;
    };
  }, [key, org, query]);

  if ((!key && !org) || !result) return null;
  if (result.error && result.people.length === 0) {
    return <p style={{ opacity: 0.6, fontSize: 12 }}>Couldn&apos;t list GitHub collaborators: {result.error}</p>;
  }
  const people = suggestPeople(result.people, members, pending);
  if (people.length === 0) return null;
  const { shown, hidden } = visiblePeople(people, showAll);

  return (
    <section aria-label="Suggested from GitHub">
      <h3 style={{ fontSize: 13, margin: "8px 0 4px" }}>Suggested from GitHub</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((p) => (
          <PersonRow key={p.login} person={p} org={org} actions={actions} roleOptions={roleOptions} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" onClick={() => setShowAll(true)} style={{ fontSize: 12, opacity: 0.7 }}>
          Show all {people.length}
        </button>
      ) : null}
    </section>
  );
}
