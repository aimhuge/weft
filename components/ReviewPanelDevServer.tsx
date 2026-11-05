"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { DevServerStatus, ReviewPlan } from "@/lib/types";

const STATE_LABEL: Record<DevServerStatus["state"], string> = {
  stopped: "not running",
  starting: "starting…",
  running: "running",
  failed: "crashed",
};

// Starts the plan's dev server when its url doesn't answer, and keeps checking that it does. stepUrl is
// the page the tour is on.
export function ReviewPanelDevServer({ cardId, plan, stepUrl }: { cardId: string; plan: ReviewPlan; stepUrl?: string }) {
  const [status, setStatus] = useState<DevServerStatus>();
  const [error, setError] = useState("");
  // Checks missed in a row, and whether the page still waits on the server's first answer (undefined until the first status).
  const misses = useRef(0);
  const waiting = useRef<boolean>(undefined);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .devStatus(cardId)
        .then((r) => {
          if (!alive) return;
          misses.current = r.status.reachable ? 0 : misses.current + 1;
          // A busy server misses a check now and then: one miss isn't down yet, unless it really crashed.
          const blip = misses.current === 1 && r.status.state !== "failed";
          setStatus((prev) => (prev?.reachable && blip ? prev : r.status));
        })
        // Best-effort 3-second poll; a transient error is picked up on the next tick.
        .catch(() => {});
    api
      .devAction(cardId, "start")
      .then((r) => alive && setStatus(r.status))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cardId]);

  // The page opened before the server was up shows nothing yet; show it the first time the server answers.
  // Only that once, and only if the server was down when the tour opened: after that the page is the user's, so a
  // restart or a missed check never moves them. The pane's error page reloads itself (electron/pane-error.cjs),
  // this covers the rest, and leaves the pane alone if it's mid-load or the user has gone elsewhere.
  const up = status?.reachable;
  useEffect(() => {
    if (!status) return;
    waiting.current ??= !up;
    if (!up || !waiting.current) return;
    waiting.current = false;
    const bridge = window.weft?.browser;
    if (!bridge || !stepUrl) return;
    void bridge
      .getState()
      .then((pane) => {
        const blank = !pane.url || pane.url === "about:blank";
        if (!pane.loading && (blank || pane.url === stepUrl)) return bridge.open(stepUrl, cardId);
      })
      .catch(() => {});
  }, [status, up, stepUrl, cardId]);

  async function act(action: "start" | "restart" | "stop") {
    setError("");
    try {
      setStatus((await api.devAction(cardId, action)).status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const state = status?.reachable ? "running" : (status?.state ?? "starting");
  const dot = state === "running" ? "bg-ok" : state === "failed" ? "bg-danger" : "bg-muted";
  return (
    <div className="mb-2 flex items-center gap-2 text-[12px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-muted" title={status?.log || plan.dev}>
        {plan.url} · {STATE_LABEL[state]}
        {error && <span className="text-danger"> · {error}</span>}
      </span>
      <button
        onClick={() => void act(state === "running" || state === "starting" ? "restart" : "start")}
        className="shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken"
      >
        {state === "running" || state === "starting" ? "Restart" : "Start"} server
      </button>
    </div>
  );
}