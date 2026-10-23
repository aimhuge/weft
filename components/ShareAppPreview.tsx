"use client";

import { useEffect, useState } from "react";
import type { AppShareState } from "@/lib/app-share-types";
import { PREVIEW_DESCRIPTION_MAX } from "@/lib/app-preview";
import { appsApi } from "@/lib/use-mini-apps";
import { Spinner } from "./Icon";
import { errorText, SHARE_BUTTON } from "./ShareParts";

type Ok = Extract<AppShareState, { kind: "ok" }>;

// How often the dialog asks again while the Mac makes the preview (a capture and a Haiku sentence, ~5-15 s).
const POLL_MS = 4000;

// The Share dialog's link preview (lib/app-share-preview-actions.ts): the card Slack or iMessage shows for this link,
// drawn from this Mac's capture, with a description you can edit (yours stays over every refresh; clearing it hands
// it back to the page and Haiku) and Refresh preview. Only a public link shows it to others; the note says so.
export function ShareAppPreview({ appId, name, state, setState }: { appId: string; name: string; state: Ok; setState: (s: AppShareState) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewKey = JSON.stringify(state.preview);

  // A fresh card each time the preview changes.
  useEffect(() => {
    if (!state.id || !state.preview) return;
    let live = true;
    appsApi.previewCard(appId).then((r) => live && setImage(r.image), (err: unknown) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [appId, state.id, previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the Mac is making it, ask again until it's done.
  useEffect(() => {
    if (!state.previewing) return;
    const timer = setTimeout(() => void appsApi.getShare(appId).then(setState, () => {}), POLL_MS);
    return () => clearTimeout(timer);
  }, [appId, state, setState]);

  if (!state.id) return null;
  const act = async (run: () => Promise<AppShareState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await run());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const description = state.preview?.description ?? "";
  return (
    <section className="mt-3 space-y-1.5" aria-label="Link preview">
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>Link preview</span>
        <button type="button" className={SHARE_BUTTON} disabled={busy || state.previewing} onClick={() => void act(() => appsApi.refreshPreview(appId))}>
          {state.previewing ? <Spinner size={12} /> : null}
          {state.previewing ? "Making preview…" : "Refresh preview"}
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line-strong bg-sunken">
        <PreviewPicture image={image} name={name} previewing={state.previewing} />
        <div className="space-y-0.5 px-2.5 py-2">
          <div className="text-[11px] text-muted">weft.zip</div>
          <div className="text-[13px] font-semibold text-ink">{state.preview?.title ?? name}</div>
          {/* Keyed on the saved text, so a description the Mac wrote (Haiku, the page) replaces the box's draft. */}
          <DescriptionBox
            key={description}
            saved={description}
            previewing={state.previewing}
            onSave={(text) => void act(() => appsApi.describe(appId, text || null))}
          />
        </div>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{previewNote(state)}</p>
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </section>
  );
}

function PreviewPicture({ image, name, previewing }: { image: string | null; name: string; previewing: boolean }) {
  if (image) return <img src={image} alt={`Link preview for ${name}`} className="block aspect-[1200/630] w-full object-cover" />;
  return (
    <div className="flex aspect-[1200/630] w-full items-center justify-center text-[12px] text-muted">
      {previewing ? "Capturing the app…" : "No preview yet. Refresh preview makes one."}
    </div>
  );
}

function DescriptionBox({ saved, previewing, onSave }: { saved: string; previewing: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(saved);
  return (
    <textarea
      value={draft}
      maxLength={PREVIEW_DESCRIPTION_MAX}
      rows={2}
      aria-label="Link description"
      placeholder={previewing ? "Writing a description from the page…" : "What this app shows, in a sentence"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== saved) onSave(draft.trim());
      }}
      className="w-full resize-none bg-transparent text-[12.5px] leading-snug text-ink outline-none placeholder:text-muted"
    />
  );
}

function previewNote(state: Ok): string {
  if (state.mode !== "public") return "Only a public link unfurls like this; other links show Weft's own card, so nothing about the app leaks.";
  if (state.preview?.by?.description === "you") return "Your description. Clear it to let Weft write one from the page.";
  return "Edit the description to use your own words.";
}
