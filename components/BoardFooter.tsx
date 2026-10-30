"use client";

import { useRegularMode } from "@/lib/use-regular-mode";
import StatusStrip from "./StatusStrip";

const REPO_URL = "https://github.com/fotoflo/weft";
const COFFEE_URL = "https://buymeacoffee.com/alexmiller";

// The desktop shell opens links in the default browser; the web build uses the link as is.
function openLink(e: React.MouseEvent, url: string) {
  if (!window.weft) return;
  e.preventDefault();
  window.weft.openExternal(url);
}

// The board's footer: the open card's (or the board's) stats, the shortcuts sheet and the credits. Regular mode has none.
export default function BoardFooter({ onHelp, ...strip }: React.ComponentProps<typeof StatusStrip> & { onHelp: () => void }) {
  if (useRegularMode()) return null;
  return (
    <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-4 py-1.5">
      <StatusStrip {...strip} />
      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-muted">
        <button onClick={onHelp} title="Keyboard shortcuts (?)" className="mr-3 hover:text-ink">
          <kbd className="mr-1 rounded border border-line-strong border-b-2 px-1 font-mono text-[10.5px]">?</kbd>
          Shortcuts
        </button>
        <a href={REPO_URL} onClick={(e) => openLink(e, REPO_URL)} className="font-medium text-ink hover:text-accent">Weft</a> v{process.env.NEXT_PUBLIC_APP_VERSION} built with{" "}
        <a href={COFFEE_URL} onClick={(e) => openLink(e, COFFEE_URL)} title="Buy me a coffee">☕</a> by{" "}
        <a href="mailto:alex@aimhuge.com" className="hover:text-accent">alex@aimhuge.com</a>
      </span>
    </footer>
  );
}
