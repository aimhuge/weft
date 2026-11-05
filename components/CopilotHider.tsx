"use client";

// The copilot's launcher: the round avatar in the window's bottom-right corner, and the persona's avatar
// the header shares with it.
import { useEffect, useRef } from "react";
import { COPILOT_LAYER, LAUNCHER, launcherBox, setCopilotLauncher } from "@/lib/copilot-float";
import type { LaneState } from "@/lib/copilot-lane";
import { personaOf, type PersonaInfo } from "@/lib/copilot-personas";
import { NO_DRAG } from "@/lib/no-drag";
import { COPILOT_ID, type Card } from "@/lib/types";
import Icon from "./Icon";

// The persona's face, cropped from its picture (Wingman's: the hovercaddy cockpit, the copilot beside you).
export function Avatar({ size, picture }: { size: number; picture: PersonaInfo["picture"] }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full border-2 border-accent"
      style={{ width: size, height: size, background: `url(${picture.src}) ${picture.avatar}` }}
    />
  );
}

// The launcher: the persona's face in a round button pinned to the window's bottom-right corner, like
// Intercom's, with a dot when the copilot said something you haven't read. It never counts cards: what needs you or
// finished is the swim lanes' job, and a count that duplicates them only grows. Resting the mouse on it for PEEK_DELAY_MS peeks
// (a pass on the way to the window edge doesn't); a click opens the chat, or closes it when it's open.
export const PEEK_DELAY_MS = 350;

export default function CopilotHider(props: {
  card: Card | null;
  unread: boolean;
  state: LaneState;
  onPeek: () => void;
  onOpen: () => void;
  onHide: () => void;
  toggleTip: string;
}) {
  const persona = personaOf(props.card?.persona);
  const open = props.state === "open";
  const peekTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  // Tell the browser pane where the launcher sits, so its native view stops short of it.
  useEffect(() => {
    const place = () => setCopilotLauncher(launcherBox({ width: window.innerWidth, height: window.innerHeight }));
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      setCopilotLauncher(null);
    };
  }, []);
  const press = () => {
    window.clearTimeout(peekTimer.current);
    if (open) props.onHide();
    else props.onOpen();
  };

  return (
    <button
      type="button"
      data-drop-target={COPILOT_ID}
      onClick={press}
      onMouseEnter={() => {
        window.clearTimeout(peekTimer.current);
        if (props.state === "hidden") peekTimer.current = window.setTimeout(props.onPeek, PEEK_DELAY_MS);
      }}
      onMouseLeave={() => window.clearTimeout(peekTimer.current)}
      title={`${open ? "Hide" : "Open"} the copilot (${persona.name}) — ${props.toggleTip}`}
      aria-label={open ? "Close the copilot" : `Open the copilot${props.unread ? " (new message)" : ""}`}
      aria-expanded={open}
      style={{ ...NO_DRAG, right: LAUNCHER.inset, bottom: LAUNCHER.bottom, width: LAUNCHER.size, height: LAUNCHER.size }}
      className={`fixed ${COPILOT_LAYER} grid place-items-center rounded-full shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      <Avatar size={LAUNCHER.size} picture={persona.picture} />
      {open && (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white">
          <Icon name="x" size={20} />
        </span>
      )}
      {!open && props.unread && (
        <span aria-hidden="true" className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full bg-accent ring-2 ring-canvas" />
      )}
    </button>
  );
}
