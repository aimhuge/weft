"use client";

// "What's new in Weft X": the first time Weft opens on a version that has a splash, its few lines (written by the
// Copywriter at release time) and, now and then, a video. Shown once (lib/release-splash.ts, lib/use-release-splash.ts).

import type { ReleaseSplash as Splash } from "@/lib/release-splash";
import { useReleaseSplash } from "@/lib/use-release-splash";
import Modal from "./Modal";
import { BUTTON_PRIMARY } from "./button-styles";

const NOTES = "https://github.com/aimhuge/weft/releases/tag/v";

export function SplashBody({ version, splash, onClose }: { version: string; splash: Splash; onClose: () => void }) {
  return (
    <Modal title={`What's new in Weft ${version}`} onClose={onClose} className="w-full max-w-[460px]">
      <div className="flex flex-col gap-3 px-5 py-4">
        {splash.video && (
          // Muted so it never talks unasked (the feature intros' rule); the controls turn the sound on.
          <video src={splash.video} autoPlay muted loop playsInline controls className="block aspect-video w-full rounded-md bg-black" />
        )}
        <ul className="flex flex-col gap-2 text-[13.5px] leading-snug text-ink">
          {splash.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-accent">
                ✦
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-between gap-3">
          <a href={`${NOTES}${version}`} target="_blank" rel="noreferrer" className="text-[12.5px] text-muted underline-offset-2 hover:underline">
            Full release notes
          </a>
          <button type="button" onClick={onClose} className={BUTTON_PRIMARY} autoFocus>
            Nice
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function ReleaseSplash() {
  const { open, close } = useReleaseSplash();
  if (!open) return null;
  return <SplashBody version={open.version} splash={open.splash} onClose={close} />;
}
