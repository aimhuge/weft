"use client";

// "Enjoying Weft?": once you've finished a handful of threads, Weft asks for a star on GitHub, once (lib/star-prompt.ts
// has the rules, lib/use-star-prompt.ts the timing). The button stars aimhuge/weft through the gh CLI you're signed in
// to; without gh, or if that fails, it opens the repo's page so you can star it there. Later asks again in two weeks.

import { useState } from "react";
import { openExternal } from "@/lib/auth/desktop";
import { finishedCount } from "@/lib/sync-prompt";
import { STAR_REPO, STAR_URL } from "@/lib/star-prompt";
import type { Card } from "@/lib/types";
import { starWeft, useStarPrompt } from "@/lib/use-star-prompt";
import { Spinner } from "./Icon";
import Modal from "./Modal";
import { BUTTON_PRIMARY as PRIMARY, BUTTON_SECONDARY as SECONDARY } from "./button-styles";

export function StarPromptDialog({
  finished,
  gh,
  onLater,
  onDone,
  star = starWeft,
}: {
  finished: number;
  // gh can star in one click; false opens the page instead.
  gh: boolean;
  onLater: () => void;
  onDone: () => void;
  star?: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [thanked, setThanked] = useState(false);

  const go = () => {
    if (!gh) {
      openExternal(STAR_URL);
      onDone();
      return;
    }
    setBusy(true);
    void star().then((ok) => {
      setBusy(false);
      if (ok) {
        setThanked(true);
        return;
      }
      openExternal(STAR_URL);
      onDone();
    });
  };

  if (thanked) {
    return (
      <Modal title="⭐ Thank you" onClose={onDone} className="w-full max-w-[400px]">
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[13.5px] text-ink">You starred {STAR_REPO}. That&apos;s how other builders find Weft.</p>
          <div className="flex justify-end">
            <button type="button" onClick={onDone} className={PRIMARY} autoFocus>
              Back to work
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="⭐ Enjoying Weft?" onClose={onLater} keepOnBackdrop className="w-full max-w-[420px]">
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[13.5px] leading-snug text-ink">
          You&apos;ve finished {finished} threads with Weft. A star on GitHub helps other builders find it, and it takes one click.
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <button type="button" onClick={onDone} className="text-[12.5px] text-muted underline-offset-2 hover:underline">
            Don&apos;t ask again
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onLater} className={SECONDARY}>
              Later
            </button>
            <button type="button" onClick={go} disabled={busy} className={PRIMARY} autoFocus>
              {busy && <Spinner size={11} />}
              {gh ? `Star ${STAR_REPO}` : "Star on GitHub"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function StarPrompt({ cards }: { cards: Card[] }) {
  const finished = finishedCount(cards);
  const { open, later, done } = useStarPrompt(finished);
  if (!open) return null;
  return <StarPromptDialog finished={finished} gh={open.gh} onLater={later} onDone={done} />;
}
