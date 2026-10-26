"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import { upsertWebhook, type WebhookAsk } from "./webhooks-view";
import type { Webhook, WebhookInput, WebhookPatch } from "./webhook-types";

// How often the open drawer asks again, so deliveries show up while a provider is being tested.
export const POLL_MS = 5000;

// The board folders' webhooks (GET /api/webhooks), loaded when the board starts (the rail's count), when the
// folders change and when the window comes back into focus, and every POLL_MS while the drawer is open
// (active). The calls change one webhook and put its answer in the list, so the row doesn't wait for the
// next poll; they throw, for the drawer to show.
export function useWebhooks(folders: string[], active = false) {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = folders.join("\n");
  // The newest load wins: an answer for folders the board has since left is dropped.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!key) return;
    const mine = ++latest.current;
    try {
      const answer = await api.webhooks(key.split("\n"));
      if (mine !== latest.current) return;
      setHooks(answer.hooks);
      setSignedIn(answer.signedIn);
      setLoaded(true);
      setError(null);
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [key]);

  useEffect(() => {
    const load = () => void reload();
    load();
    window.addEventListener("focus", load);
    const poll = active ? setInterval(load, POLL_MS) : null;
    return () => {
      window.removeEventListener("focus", load);
      if (poll) clearInterval(poll);
    };
  }, [reload, active]);

  const put = (hook: Webhook) => setHooks((list) => upsertWebhook(list, hook));
  const add = async (input: WebhookInput) => {
    const answer = await api.addWebhook(input);
    put(answer.hook);
    return answer;
  };
  // The change shows at once (Mark registered flips the moment you click it); a refusal reloads what the server has.
  const update = async (id: string, patch: WebhookPatch) => {
    setHooks((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    try {
      put((await api.updateWebhook(id, patch)).hook);
    } catch (err) {
      void reload();
      throw err;
    }
  };
  const remove = async (id: string) => {
    await api.removeWebhook(id);
    setHooks((list) => list.filter((h) => h.id !== id));
  };
  const relay = async (id: string) => put((await api.relayWebhook(id)).hook);
  const unrelay = async (id: string) => put((await api.unrelayWebhook(id)).hook);

  return { hooks, signedIn, loaded, error, reload, add, update, remove, relay, unrelay };
}

// A thread asking the user to register a webhook it added (main's "add-webhook" message), and the palette's
// open: open the 🪝 drawer and ask it to expand that webhook's row. The drawer may not be open yet, or still
// loading, so the ask waits for a taker (onWebhookAsk) that can serve it, like lib/use-vault.ts's addSecret.
type Taker = (ask?: WebhookAsk) => boolean;
let pending: { ask?: WebhookAsk } | null = null;
let taker: Taker | null = null;

export function addWebhookAsk(openDrawer: (panel: "webhooks") => void, ask?: WebhookAsk) {
  openDrawer("webhooks");
  pending = taker?.(ask) ? null : { ask };
}

// The drawer's taker expands the row and says whether it could; the returned function unsubscribes.
export function onWebhookAsk(take: Taker): () => void {
  taker = take;
  if (pending && take(pending.ask)) pending = null;
  return () => {
    if (taker === take) taker = null;
  };
}
