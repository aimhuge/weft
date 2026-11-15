"use client";

// weft.zip's phone-width input bar, the phone app's own design (~/dev/weft-mobile src/components/Composer.tsx) in the
// DOM: a 🎙/⌨ toggle on the left swaps the text field for one wide "Hold to talk" bar. Hold it and talk; let go to send
// what you said, or slide up and let go to cancel. The words come from the browser's own speech recognition
// (lib/use-dictation.ts). ⊕ opens the tray (Photos, Camera, File, Paste), ↑ sends what's typed, and ⋯ holds Add to
// Backlog, so Start stays one tap.
import { useRef, useState, type RefObject } from "react";
import { useUiText } from "@/lib/ui-language";
import { useDictation } from "@/lib/use-dictation";
import { PhoneTray } from "./PhoneTray";

// How far up a finger slides before letting go cancels, in px.
const CANCEL_AT = 60;
const ROUND = "flex h-10 w-10 flex-none items-center justify-center rounded-full border border-line-strong text-[17px] text-ink disabled:opacity-40";

export interface PhoneInputBarProps {
  text: string;
  onText: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  // Starts the card with what's typed and, from Hold to talk, what was said.
  onSend: (said?: string) => void;
  onBacklog: () => void;
  onFiles: (files: File[]) => void;
  canBacklog: boolean;
  busy: boolean;
}

// The wide "Hold to talk" bar: pressing starts the recognizer, letting go sends what was said, and sliding up first
// turns it into a cancel.
function HoldButton({ dictation, busy, onRelease }: { dictation: ReturnType<typeof useDictation>; busy: boolean; onRelease: () => void }) {
  const t = useUiText();
  const [cancelling, setCancelling] = useState(false);
  const holdY = useRef(0);
  const listening = dictation.state === "recording";
  const label = !listening ? t("Hold to talk") : cancelling ? t("Release to cancel") : t("Release to send");
  const look = !listening ? "border-line-strong bg-canvas text-ink" : cancelling ? "border-danger bg-danger text-on-accent" : "border-accent bg-accent text-on-accent";
  return (
    <button
      type="button"
      disabled={busy}
      onPointerDown={(e) => {
        // Keeps the finger's moves and its release on this button even once it slides off; not every browser has it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The bar still works; a release off the button just isn't seen.
        }
        holdY.current = e.clientY;
        setCancelling(false);
        dictation.toggle();
      }}
      onPointerMove={(e) => {
        if (listening) setCancelling(e.clientY < holdY.current - CANCEL_AT);
      }}
      onPointerUp={() => {
        if (cancelling) dictation.cancel();
        else onRelease();
        setCancelling(false);
      }}
      className={`h-10 flex-1 select-none rounded-full border text-[15px] font-bold ${look}`}
      style={{ touchAction: "none" }}
    >
      {label}
    </button>
  );
}

// Hold to talk is where the bar starts; flipping to the keyboard (or back) sticks, for the next card and the next visit.
const TALK_KEY = "weft.phone.talk";
function storedTalk(): boolean {
  try {
    return localStorage.getItem(TALK_KEY) !== "0";
  } catch {
    return true;
  }
}
function storeTalk(on: boolean) {
  try {
    localStorage.setItem(TALK_KEY, on ? "1" : "0");
  } catch {
    // Private mode or no storage: the choice lasts this visit only.
  }
}

export function PhoneInputBar({ text, onText, field, onSend, onBacklog, onFiles, canBacklog, busy }: PhoneInputBarProps) {
  const t = useUiText();
  const [talk, setTalkState] = useState(storedTalk);
  const setTalk = (on: boolean) => {
    storeTalk(on);
    setTalkState(on);
  };
  const [tray, setTray] = useState(false);
  const [more, setMore] = useState(false);
  // Set when the hold ends in a send: the words the recognizer hands back then start the card.
  const sendSaid = useRef(false);
  const dictation = useDictation((said) => {
    if (sendSaid.current) {
      sendSaid.current = false;
      onSend(said);
    } else onText([text, said].filter(Boolean).join(" "));
  });
  const release = () => {
    sendSaid.current = true;
    dictation.toggle();
  };
  return (
    <div className="border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
      {dictation.error && (
        <p role="alert" className="px-3 pt-2 text-[12px] text-danger">
          {dictation.error}
        </p>
      )}
      <div className="flex items-end gap-1.5 px-2.5 py-2">
        <button type="button" className={ROUND} onClick={() => setTalk(!talk)} aria-label={talk ? t("Type instead") : t("Talk instead")}>
          {talk ? "⌨" : "🎙"}
        </button>
        {talk ? (
          <HoldButton dictation={dictation} busy={busy} onRelease={release} />
        ) : (
          <textarea
            ref={field}
            value={text}
            onChange={(e) => onText(e.target.value)}
            onFocus={() => setTray(false)}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            placeholder={t("What should this thread do?")}
            aria-label={t("Prompt")}
            className="min-h-10 flex-1 resize-none rounded-[20px] border border-line-strong bg-canvas px-3.5 py-2 text-[15px] text-ink outline-none focus:border-accent"
          />
        )}
        {!talk && text.trim() ? (
          <button type="button" className={`${ROUND} border-accent bg-accent text-on-accent`} disabled={busy} onClick={() => onSend()} aria-label={t("Start")}>
            ↑
          </button>
        ) : (
          <button type="button" className={ROUND} onClick={() => { setTray((v) => !v); setMore(false); }} aria-label={tray ? t("Close attachments") : t("Attach")} aria-expanded={tray}>
            ⊕
          </button>
        )}
        <div className="relative">
          <button type="button" className={ROUND} onClick={() => { setMore((v) => !v); setTray(false); }} aria-label={t("More")} aria-expanded={more}>
            ⋯
          </button>
          {more && (
            <div role="menu" className="absolute bottom-full right-0 mb-2 w-48 rounded-lg border border-line-strong bg-panel p-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                disabled={!canBacklog || busy}
                title={canBacklog ? undefined : t("A worker has no Backlog yet: its threads start when they're made.")}
                onClick={() => { setMore(false); onBacklog(); }}
                className="w-full rounded-md px-3 py-2.5 text-left text-[14px] text-ink hover:bg-sunken disabled:opacity-40"
              >
                {t("Add to Backlog")}
              </button>
            </div>
          )}
        </div>
      </div>
      {tray && <PhoneTray onFiles={(files) => { setTray(false); onFiles(files); }} />}
    </div>
  );
}
