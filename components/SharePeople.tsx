"use client";

// The Share dialog's People field (docs/architecture/sharing.md#people): name anyone on GitHub and they get in to this
// link once signed in to weft.zip with that account, whatever the mode, with no seat in your workspace. It opens on the
// card's repo collaborators, searches GitHub logins as you type, and lists who's in, each chip saying whether they
// opened it, got an email, or need the link from you (no address on file).
import { useEffect, useState } from "react";
import type { MentionPerson } from "@weft/client";
import { grantApi } from "@/lib/share-grant-client";
import { grantStatus, mergePeople } from "@/lib/share-people";
import { isGithubLogin, type GrantNotice, type ShareGrant } from "@/lib/share-grant-types";
import PeopleTypeahead from "./PeopleTypeahead";
import { errorText } from "./ShareParts";

const SEARCH_MS = 200;

// A small Copy link for a line of text: the chip that says "send them the link", the mention bar.
export function CopyLinkInline({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-accent underline"
      onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true), () => {})}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function usePeopleSearch(cardId: string, query: string, open: boolean): MentionPerson[] {
  const [suggested, setSuggested] = useState<MentionPerson[] | null>(null);
  const [found, setFound] = useState<{ q: string; people: MentionPerson[] }>({ q: "", people: [] });
  const wantSuggested = open && suggested === null;
  useEffect(() => {
    if (!wantSuggested) return;
    let ignore = false;
    grantApi.people("", cardId).then((p) => !ignore && setSuggested(p), () => !ignore && setSuggested([]));
    return () => {
      ignore = true;
    };
  }, [wantSuggested, cardId]);
  const q = query.trim().replace(/^@/, "");
  useEffect(() => {
    if (!open || !q) return;
    let ignore = false;
    const run = () => void grantApi.people(q).then((people) => !ignore && setFound({ q, people }), () => {});
    const timer = setTimeout(run, SEARCH_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [open, q]);
  return open ? mergePeople(q, { suggested: suggested ?? [], found: q && found.q ? found.people : [] }) : [];
}

function Chip({ grant, notice, url, onRemove }: { grant: ShareGrant; notice?: GrantNotice; url: string | null; onRemove: () => void }) {
  const status = grantStatus(grant, notice);
  const tone = status.tone === "ok" ? "text-ok" : status.tone === "warn" ? "text-warn" : "text-muted";
  return (
    <li className="flex items-center gap-1.5 text-[12.5px]">
      <span className="font-mono text-ink">@{grant.login}</span>
      <span className={`min-w-0 flex-1 truncate text-[11.5px] ${tone}`}>
        {status.text}
        {status.tone === "warn" && url && (
          <>
            {" "}
            <CopyLinkInline url={url} />
          </>
        )}
      </span>
      <button type="button" aria-label={`Remove @${grant.login}`} className="px-1 text-muted hover:text-danger" onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

export function SharePeople({ cardId, url }: { cardId: string; url: string | null }) {
  // Its own error line: the dialog's replaces the whole body, and "No GitHub user @x" shouldn't hide the link.
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<ShareGrant[]>([]);
  const [notices, setNotices] = useState<Record<string, GrantNotice>>({});
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const people = usePeopleSearch(cardId, query, open).filter((p) => !grants.some((g) => g.login.toLowerCase() === p.login.toLowerCase()));

  useEffect(() => {
    let ignore = false;
    grantApi.list(cardId).then((s) => !ignore && setGrants(s.grants), () => {});
    return () => {
      ignore = true;
    };
  }, [cardId]);

  async function add(login: string) {
    const name = login.trim().replace(/^@/, "");
    if (!isGithubLogin(name) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [out] = await grantApi.grant(cardId, { logins: [name], via: "share" });
      if (!out) return;
      if (!out.ok) {
        setError(out.error);
        return;
      }
      setGrants((g) => [...g.filter((x) => x.githubId !== out.grant.githubId), out.grant]);
      setNotices((n) => ({ ...n, [out.grant.login]: out.notice }));
      setQuery("");
      setActive(0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(grant: ShareGrant) {
    try {
      setGrants((await grantApi.revoke(cardId, grant.githubId)).grants);
    } catch (err) {
      setError(errorText(err));
    }
  }

  function onKey(e: React.KeyboardEvent) {
    const last = people.length - 1;
    if (e.key === "ArrowDown" && last >= 0) setActive((i) => (i >= last ? 0 : i + 1));
    else if (e.key === "ArrowUp" && last >= 0) setActive((i) => (i <= 0 ? last : i - 1));
    else if (e.key === "Escape" && open) setOpen(false);
    else if (e.key === "Enter") void add(people[Math.min(active, last)]?.login ?? query);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="mt-3 text-[12.5px]">
      <label className="block text-ink" htmlFor="share-people">
        People
        <span className="ml-1.5 text-[12px] text-muted">anyone on GitHub; they sign in to open it, whatever the mode</span>
      </label>
      <div className="relative mt-1">
        <input
          id="share-people"
          value={query}
          placeholder="@github username"
          autoComplete="off"
          disabled={busy}
          className="w-full rounded-md border border-line-strong bg-canvas px-2 py-1 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
        {open && people.length > 0 && (
          <PeopleTypeahead people={people} active={Math.min(active, people.length - 1)} className="inset-x-0 top-full mt-1" onPick={(p) => void add(p.login)} onHover={setActive} />
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
      {grants.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {grants.map((g) => (
            <Chip key={g.githubId} grant={g} notice={notices[g.login]} url={url} onRemove={() => void remove(g)} />
          ))}
        </ul>
      )}
    </div>
  );
}
