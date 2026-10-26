"use client";

import { answerNow, stopNow } from "@/lib/optimistic-cards";
import { api } from "@/lib/client";
import { LANE_WIDTH, type LaneState } from "@/lib/copilot-lane";
import { personaOf } from "@/lib/copilot-personas";
import { isLive } from "@/lib/format";
import { COPILOT_ID, type Card } from "@/lib/types";
import { useCopilotThread } from "@/lib/use-copilot-thread";
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

// The copilot's lane on the right of the board. Three states, like Intercom's hider: hidden is a 36px
// pill pinned to the right edge, peek is the 236px digest column, open is the 520px chat over the
// cockpit. The hider pill hovers into peek; the copilot needing you auto-expands into peek; ⌘J
// cycles hidden → peek → open → hidden.
export default function CopilotLane(props: {
  state: LaneState;
  cards: Card[];
  // The board's selected project (null: All), so the empty chat's chips match it.
  project?: string | null;
  onOpenCard: (card: Card) => void;
  onHide: () => void;
  onPeek: () => void;
  onOpen: () => void;
  toggleTip: string;
}) {
  const { card, items, streaming, error, fail, send, newChat, setPersona, resetting } = useCopilotThread();
  const live = card ? isLive(card) : false;
  const persona = personaOf(card?.persona);

  if (props.state === "hidden") {
    return (
      <aside
        data-copilot-lane="hidden"
        style={{ width: LANE_WIDTH.hidden }}
        className="shrink-0 self-stretch border-l border-line-strong bg-sunken"
      >
        <CopilotHider
          card={card}
          cards={props.cards}
          items={items}
          onPeek={props.onPeek}
          onOpen={props.onOpen}
          toggleTip={props.toggleTip}
        />
      </aside>
    );
  }

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
      <button
        onClick={props.onHide}
        title={`Hide — ${props.toggleTip}`}
        aria-label="Hide the copilot"
        className="grid h-6 w-6 place-items-center rounded-md bg-black/30 text-muted hover:bg-black/50 hover:text-ink"
      >
        <Icon name="chevronRight" size={13} />
      </button>
    </header>
  );

  if (!isOpen) {
    return (
      <aside
        data-copilot-lane="peek"
        style={{ width: LANE_WIDTH.peek }}
        className="flex shrink-0 flex-col border-l border-line-strong bg-sunken"
      >
        {header}
        <CopilotPeek
          cards={props.cards}
          persona={persona}
          items={items}
          error={error}
          onHide={props.onHide}
          onOpen={props.onOpen}
          onOpenCard={props.onOpenCard}
          onAsk={(text) => {
            props.onOpen();
            send(text).catch(fail);
          }}
        />
      </aside>
    );
  }

  return (
    <aside
      data-copilot-lane="open"
      data-drop-target={COPILOT_ID}
      style={{ width: LANE_WIDTH.open }}
      className="relative flex shrink-0 flex-col overflow-hidden border-l border-line-strong bg-canvas"
    >
      {/* The cockpit sits in a small modal window at the top, behind a header bar on a dark surface,
          so the copilot photo reads like a framed card rather than a background the chat sits on. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[44%]"
        style={{ background: "linear-gradient(180deg, rgb(0 0 0 / 0.92) 0, rgb(0 0 0 / 0.85) 100%)" }}
      />
      <div className="pointer-events-none absolute inset-x-3 top-[3.25rem] z-0 h-[26%] overflow-hidden rounded-xl ring-1 ring-white/10 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)]">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: `url(${persona.picture.src}) ${persona.picture.frame}` }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgb(0 0 0 / 0.15) 0, rgb(0 0 0 / 0.45) 100%)" }}
        />
      </div>
      <div className="relative z-10">{header}</div>
      {/* Spacer for the framed cockpit panel above. */}
      <div className="h-[26%] shrink-0" aria-hidden="true" />
      {error && <p className="relative z-10 mx-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
      {card ? (
        // Conversation lives on the light canvas below the modal — every line stays fully visible, no
        // fade-out as messages scroll up.
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
    </aside>
  );
}
