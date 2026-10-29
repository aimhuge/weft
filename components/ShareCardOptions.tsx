"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { CardShareState, CardShareUpdate } from "@/lib/share-types";
import { APP_SLUG_RE } from "@/lib/app-share-types";
import { errorText } from "./ShareParts";

type Ok = Extract<CardShareState, { kind: "ok" }>;

// The Share dialog's two thread-only choices, under the access fields (components/ShareCardDialog.tsx): the
// link's address, weft.zip/@<you>/threads/<slug> like a mini app's (saved on blur or Enter; lib/card-share.ts
// refuses a taken one), and whether the link shows the chat or only the browser pane. Each saves on its own,
// keeping the mode and password as they are.
export function ShareCardOptions({
  cardId,
  state,
  setState,
  setError,
}: {
  cardId: string;
  state: Ok;
  setState: (s: CardShareState) => void;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save(change: Pick<CardShareUpdate, "showChat" | "slug">) {
    setBusy(true);
    setError(null);
    try {
      setState(await api.setShare(cardId, { mode: state.mode, ...change }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 text-[12.5px]">
      {state.id && state.slug && <SlugRow key={state.slug} state={state} busy={busy} onSave={(slug) => void save({ slug })} onBad={setError} />}
      <label className="flex items-start gap-2 text-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.showChat}
          disabled={busy}
          onChange={(e) => void save({ showChat: e.currentTarget.checked })}
        />
        <span>
          Show the chat
          <span className="block text-[12px] text-muted">
            {state.showChat ? "Viewers see this thread beside its browser pane." : "Viewers see only the browser pane; the thread stays on your Mac."}
          </span>
        </span>
      </label>
    </div>
  );
}

// "weft.zip/@you/threads/ [slug]": the address up to the slug comes from the link the server answered.
function SlugRow({ state, busy, onSave, onBad }: { state: Ok; busy: boolean; onSave: (slug: string) => void; onBad: (e: string) => void }) {
  // Keyed on the slug by the parent, so a new slug from the server starts a fresh draft.
  const [draft, setDraft] = useState(state.slug ?? "");
  const url = state.url ?? "";
  const prefix = url.includes("/threads/") ? url.slice(0, url.lastIndexOf("/") + 1).replace(/^https?:\/\//, "") : null;
  if (!prefix) return null;

  function commit() {
    const slug = draft.trim();
    if (slug === state.slug) return;
    if (APP_SLUG_RE.test(slug)) onSave(slug);
    else onBad("Pick an address of 1 to 40 letters, digits, or hyphens.");
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-muted">
      <span>{prefix}</span>
      <input
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label="Address"
        className="w-40 rounded-md border border-line bg-canvas px-2 py-1 text-ink outline-none focus:border-accent"
      />
    </div>
  );
}
