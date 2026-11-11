"use client";

// Settings → Security: the sites a thread opens in the browser pane without asking (electron/pane-sites.cjs). Local
// pages and the public top 1000 sites are built in; this lists the hosts you added here or said yes to on a
// thread's prompt, to take one back out. Only the desktop shell has the list: on the web board the row says so.

import { useEffect, useState } from "react";
import Icon from "./Icon";
import { SettingsSectionHeader } from "./SettingsLayout";

const BUTTON = "rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40";

const paneBridge = () => (typeof window === "undefined" ? undefined : window.weft?.browser);

export default function PaneSites() {
  const [sites, setSites] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const bridge = paneBridge();
    if (!bridge?.sites) return;
    bridge.sites().then((list) => live && setSites(list), () => live && setSites([]));
    return () => {
      live = false;
    };
  }, []);

  async function add() {
    const host = await paneBridge()?.addSite?.(draft);
    if (!host) {
      setError(`"${draft}" isn't a site's address.`);
      return;
    }
    setError("");
    setDraft("");
    setSites((s) => [...new Set([...(s ?? []), host])].sort());
  }

  async function remove(host: string) {
    if (await paneBridge()?.removeSite?.(host)) setSites((s) => (s ?? []).filter((x) => x !== host));
  }

  return (
    <section className="flex flex-col gap-2.5">
      <SettingsSectionHeader
        title="Sites threads open without asking"
        hint="In the browser pane: localhost and the public top 1000 sites, but not ones you'd be signed into (mail, banks, shopping, social, code). Any other site asks once with Touch ID; a yes lands here."
      />
      {sites === null ? (
        <p className="text-[12.5px] text-muted">Only in the desktop app.</p>
      ) : (
        <>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void add();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="tiktok.com"
              aria-label="Site to allow"
              className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-[12.5px] text-ink"
            />
            <button type="submit" disabled={!draft.trim()} className={`flex shrink-0 items-center gap-1.5 ${BUTTON}`}>
              <Icon name="plus" size={12} /> Add
            </button>
          </form>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {sites.length > 0 && (
            <ul className="flex flex-col gap-1">
              {sites.map((host) => (
                <li key={host} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{host}</span>
                  <button type="button" aria-label={`Ask again before opening ${host}`} onClick={() => void remove(host)} className={`flex shrink-0 items-center gap-1.5 ${BUTTON}`}>
                    <Icon name="x" size={12} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
