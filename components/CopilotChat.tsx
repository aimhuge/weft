"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { handFiles } from "@/lib/file-drop";
import { useFileDrop } from "@/lib/use-file-drop";
import { localSignedAnswer } from "@/lib/answer-signer";
import { api, mergeThread } from "@/lib/client";
import { isLive } from "@/lib/format";
import { useBoardEvents } from "@/lib/use-events";
import { useTitleBarZoom } from "@/lib/use-title-bar-zoom";
import { COPILOT_ID, type Card, type ThreadItem } from "@/lib/types";
import CopilotEmpty from "./CopilotEmpty";
import CrashGuard from "./CrashGuard";
import Icon, { Spinner } from "./Icon";
import ThreadView from "./ThreadView";

function Status({ card }: { card: Card }) {
  if (card.column === "running") {
    return (
      <span className="flex items-center gap-1 text-[11.5px] text-accent">
        <Spinner size={10} /> Working
      </span>
    );
  }
  if (card.column === "needs_you") return <span className="text-[11.5px] text-warn">Needs you</span>;
  return <span className="text-[11.5px] text-faint">{card.warm ? "Ready" : "Idle"}</span>;
}

const noopSubscribe = () => () => {};

// The orchestrator: one long-lived thread that can see and run the board.
export default function CopilotChat() {
  const [card, setCard] = useState<Card | null>(null);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);
  // On macOS the header doubles as the title bar, under the window's traffic lights.
  const mac = useSyncExternalStore(noopSubscribe, () => window.weft?.platform ?? "", () => "") === "darwin";
  useTitleBarZoom();
  // The copilot's own window: files dropped anywhere in it go to its reply box.
  useFileDrop((_spot, files) => handFiles(COPILOT_ID, files));

  // The first load keeps live items that arrived during the fetch; after a reconnect, what's shown
  // may be stale, so the snapshot replaces it.
  const load = useCallback(async () => {
    const merge = !opened.current;
    opened.current = true;
    const { card } = await api.copilot();
    setCard(card);
    const { items } = await api.thread(card.id);
    setItems((prev) => (merge ? mergeThread(items, prev) : items));
  }, []);

  useBoardEvents(
    (event) => {
      switch (event.type) {
        case "card":
          if (event.card.id === COPILOT_ID) setCard(event.card);
          break;
        case "thread":
          if (event.cardId !== COPILOT_ID) break;
          setItems((prev) => {
            const next = prev.slice();
            next[event.index] = event.item;
            return next;
          });
          if (event.item.kind === "assistant" || event.item.kind === "result") setStreaming("");
          break;
        case "thread_cleared":
          if (event.cardId !== COPILOT_ID) break;
          setItems([]);
          setStreaming("");
          break;
        case "delta":
          if (event.cardId === COPILOT_ID) setStreaming((text) => text + event.text);
          break;
      }
    },
    () => {
      load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    },
  );

  async function send(text: string) {
    await api.send(COPILOT_ID, text);
  }

  async function newChat() {
    setItems([]);
    setStreaming("");
    const { card } = await api.resetCopilot();
    setCard(card);
  }

  const live = card ? isLive(card) : false;

  return (
    <div data-drop-target={COPILOT_ID} className="flex h-screen flex-col bg-panel">
      <header
        className={`flex shrink-0 items-center gap-2 border-b border-line ${mac ? "app-drag mac-title-bar pr-3" : "px-3 py-2.5"}`}
      >
        <Icon name="sparkles" size={15} className="text-accent" />
        <h1 className="text-[13.5px] font-semibold text-ink">Copilot</h1>
        {card && <Status card={card} />}
        <div className="flex-1" />
        {live && (
          <button
            onClick={() => void api.stop(COPILOT_ID).catch(() => {})}
            className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[11.5px] text-ink hover:bg-sunken"
          >
            <Icon name="stop" size={11} /> Stop
          </button>
        )}
        <button
          onClick={() => void newChat().catch((err: unknown) => setError(String(err)))}
          title="Start a new conversation"
          className="rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
        >
          New chat
        </button>
      </header>

      {error && <p className="border-b border-line bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}

      {card ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Keeps the header's New chat working when the conversation fails to draw. */}
          <CrashGuard what="conversation" className="m-3">
          <ThreadView
            card={card}
            items={items}
            streaming={streaming}
            onSend={send}
            onAnswer={(allow, answers, reply) => void localSignedAnswer(card, allow).then((auth) => api.answer(COPILOT_ID, allow, answers, card.pending?.id, reply, auth)).catch(() => {})}
            placeholder="Ask about your threads, or tell me what to start"
            empty={<CopilotEmpty onAsk={(text) => void send(text).catch((err: unknown) => setError(String(err)))} />}
          />
          </CrashGuard>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-faint">
          <Spinner size={16} />
        </div>
      )}
    </div>
  );
}
