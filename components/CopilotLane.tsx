"use client";

import { useEffect, useState, type ReactNode } from "react";
import { answerNow, stopNow } from "@/lib/optimistic-cards";
import { api } from "@/lib/client";
import { COPILOT_LAYER, LAUNCHER, PANEL, PANEL_BOTTOM, panelBox, setCopilotPanel } from "@/lib/copilot-float";
import type { LaneState } from "@/lib/copilot-lane";
import { personaOf } from "@/lib/copilot-personas";
import { isLive } from "@/lib/format";
import { NO_DRAG } from "@/lib/no-drag";
import { COPILOT_ID, type Card } from "@/lib/types";
import { useCopilotThread } from "@/lib/use-copilot-thread";
import { useCopilotUnread } from "@/lib/use-copilot-unread";
import CopilotEmpty from "./CopilotEmpty";
import CopilotHider, { Avatar } from "./CopilotHider";
import CopilotPeek from "./CopilotPeek";
import CopilotPersonaMenu from "./CopilotPersonaMenu";
import CrashGuard from "./CrashGuard";
import Icon, { Spinner } from "./Icon";
import ThreadView from "./ThreadView";

function Status({ card }: { card: Card | null }) {
  if (!card) return <span className="text-[11px] text-faint">Starting…</span>;
  if (card.column === "running") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-accent">
        <Spinner size={9} /> Working
      </span>
    );
  }
  if (card.column === "needs_you") return <span className="text-[11px] text-warn">Needs you</span>;
  return <span className="text-[11px] text-muted">{card.warm ? "Ready" : "Idle"}</span>;
}

// The copilot floats in the window's bottom-right corner, like Intercom's messenger, over the board,
// the card window and every dialog, the welcome included (lib/copilot-float.ts). Three states: hidden is
// the round launcher alone; peek adds its latest reply or idea above it; open adds the chat. Resting
// on the launcher peeks; the copilot needing you auto-expands into peek; a click on the launcher opens
// or closes the chat; ⌘J cycles hidden → peek → open → hidden.
export default function CopilotLane(props: {
  state: LaneState;
  // The board's selected project (null: All), so the empty chat's chips match it.
  project?: string | null;
  onHide: () => void;
  onPeek: () => void;
  onOpen: () => void;
  toggleTip: string;
}) {
  const { card, items, streaming, error, fail, send, newChat, setPersona, resetting } = useCopilotThread();
  const live = card ? isLive(card) : false;
  const persona = personaOf(card?.persona);
  const unread = useCopilotUnread(items, props.state);

  const launcher = (
    <CopilotHider
      card={card}
      unread={unread}
      state={props.state}
      onPeek={props.onPeek}
      onOpen={props.onOpen}
      onHide={props.onHide}
      toggleTip={props.toggleTip}
    />
  );
  if (props.state === "hidden") return launcher;

  const isOpen = props.state === "open";

  const header = (
    <header className="relative flex shrink-0 items-center gap-2 px-2.5 py-2">
      <Avatar size={isOpen ? 30 : 26} picture={persona.picture} />
      <div className="min-w-0 flex-1 leading-tight">
        <CopilotPersonaMenu persona={card?.persona} busy={!card || resetting} onPick={(p) => void setPersona(p).catch(fail)} />
        <Status card={card} />
      </div>
      {isOpen && live && (
        <button
          onClick={() => void stopNow(COPILOT_ID).catch(fail)}
          className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50"
        >
          <Icon name="stop" size={11} /> Stop
        </button>
      )}
      {isOpen && (
        <button
          onClick={() => void newChat().catch(fail)}
          disabled={resetting}
          title="Start a new conversation"
          className="rounded-md bg-black/30 px-2 py-1 text-[11.5px] text-ink hover:bg-black/50 disabled:opacity-60"
        >
          {resetting ? "Starting…" : "New chat"}
        </button>
      )}
      {!isOpen && (
        <button
          onClick={props.onOpen}
          title="Open the chat"
          aria-label="Open the chat"
          className="grid h-6 w-6 place-items-center rounded-md bg-black/30 text-muted hover:bg-black/50 hover:text-ink"
        >
          <Icon name="expand" size={12} />
        </button>
      )}
      <button
        onClick={props.onHide}
        title={`Hide — ${props.toggleTip}`}
        aria-label="Hide the copilot"
        className="grid h-6 w-6 place-items-center rounded-md bg-black/30 text-muted hover:bg-black/50 hover:text-ink"
      >
        <Icon name="chevronDown" size={13} />
      </button>
    </header>
  );

  if (!isOpen) {
    return (
      <>
        <FloatPanel state="peek" className="bg-sunken">
          {header}
          <CopilotPeek
            persona={persona}
            items={items}
            error={error}
            onHide={props.onHide}
            onOpen={props.onOpen}
            onAsk={(text) => {
              props.onOpen();
              send(text).catch(fail);
            }}
          />
        </FloatPanel>
        {launcher}
      </>
    );
  }

  return (
    <>
      <FloatPanel state="open" className="bg-canvas">
        <div className="relative z-10 border-b border-line">{header}</div>
        {error && <p className="relative z-10 mx-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
        {card ? (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col bg-canvas">
            <CrashGuard what="conversation" className="m-3">
              <ThreadView
                card={card}
                items={items}
                streaming={streaming}
                onSend={send}
                onAnswer={(allow, answers, reply) => {
                  // A plain Allow or Deny leaves at once, as on any card (lib/thread-handlers.ts).
                  const pendingId = card.pending?.id;
                  const send = () => api.answer(COPILOT_ID, allow, answers, pendingId, reply);
                  return (pendingId && !answers && !reply ? answerNow(COPILOT_ID, pendingId, allow, send) : send()).catch((err: unknown) => {
                    fail(err);
                    throw err;
                  });
                }}
                placeholder="Ask about your threads, or tell me what to start"
                empty={<CopilotEmpty project={props.project} onAsk={(text) => void send(text).catch(fail)} />}
              />
            </CrashGuard>
          </div>
        ) : (
          <div className="relative flex flex-1 items-center justify-center text-faint">
            <Spinner size={16} />
          </div>
        )}
      </FloatPanel>
      {launcher}
    </>
  );
}

// The peek or the chat: a rounded window stacked above the launcher, sized to the window and never
// past its edges. It publishes its box so the native browser pane steps aside while they overlap.
function FloatPanel({ state, className, children }: { state: "peek" | "open"; className: string; children: ReactNode }) {
  const [win, setWin] = useState(() =>
    typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    const resize = () => setWin({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const box = panelBox(win, PANEL[state]);
  useEffect(() => setCopilotPanel(box), [box.x, box.y, box.width, box.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCopilotPanel(null), []);

  return (
    <aside
      data-copilot-lane={state}
      data-drop-target={state === "open" ? COPILOT_ID : undefined}
      style={{ ...NO_DRAG, right: LAUNCHER.inset, bottom: PANEL_BOTTOM, width: box.width, height: box.height }}
      className={`fixed ${COPILOT_LAYER} flex flex-col overflow-hidden rounded-2xl border border-line-strong shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)] ${className}`}
    >
      {children}
    </aside>
  );
}
