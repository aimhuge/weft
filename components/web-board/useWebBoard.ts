"use client";

// The weft.zip board's data: the org's cards, which one is open, the commands this board sent and the signed blob
// URLs, kept live through Supabase Realtime. The open card's thread is the desktop's own ThreadView, fed by the cloud
// transport this hands out (useCloudTransport.ts): its pages, its share of this channel's item changes, and Stop. The browser client is the visitor's own cookie session
// (@supabase/ssr's createBrowserClient with the publishable key), so RLS gates both the reads and the
// Realtime stream: the same SELECT policy that gates a read gates what postgres_changes sends.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { answerCommand, newCardCommand, replyCommand, stopCommand, type CloudCommandRow, type GrantScope, type NewCardForm, type NewCommand } from "@/lib/cloud-commands";
import { BLOB_BUCKET, type CloudCardRow, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import type { CloudItemChange } from "@/lib/cloud-thread-page";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";
import type { QuestionReply } from "@/lib/types";
import { applyCardChange, batchBlobRefs, blobPath, buildBlobUrlMap } from "@/lib/web-board";
import { cardThumbRefs, withThumbUrls } from "@/lib/web-board-thumbs";
import { applyCommandChange, isCardCommand, type CloudCommandChange, type WebTarget } from "@/lib/web-commands";
import { loadWebKeyring, openSyncedCard, openSyncedTool } from "@/lib/web-sync-key";
import { useCloudTransport, type CloudBlobs, type ItemBus } from "./useCloudTransport";

// The status of the Realtime channel; the dot beside the title reflects it.
export type LiveStatus = "connecting" | "live" | "offline";

export interface WebBoardInput {
  orgId: string;
  // The signed-in visitor, to tell their own commands from a teammate's.
  userId: string;
  // Their commands that haven't finished (or failed) when the page loaded.
  initialCommands: CloudCommandRow[];
  initialCards: CloudCardRow[];
  openCardId: string | null;
  initialBlobUrls: Record<string, string>;
}

type Change<Row> = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Row | null; old: Partial<Row> | null };

// Supabase types a change as a generic payload; the row shapes are lib/cloud-sync-types'.
function changeOf<Row>(payload: { eventType: string; new: unknown; old: unknown }): Change<Row> | null {
  const change: Change<Row> = {
    eventType: payload.eventType as Change<Row>["eventType"],
    new: (payload.new as Row | null) ?? null,
    old: (payload.old as Partial<Row> | null) ?? null,
  };
  return change.new || change.old ? change : null;
}

// Resolve blob refs to URLs: the server's route first (presigned R2 for blobs copied there, Supabase for the rest;
// docs/architecture/r2.md), and the browser's own Supabase signing, 50 to a call, when the route can't answer.
// A batch that fails is skipped; the renderer leaves the ref visible instead of crashing.
async function signedUrls(client: SupabaseClient, orgId: string, refs: readonly string[]): Promise<Record<string, string>> {
  const viaServer = await serverUrls(orgId, refs);
  if (viaServer) return viaServer;
  const out: Record<string, string> = {};
  for (const batch of batchBlobRefs(refs)) {
    try {
      const { data, error } = await client.storage.from(BLOB_BUCKET).createSignedUrls(batch.map((r) => blobPath(orgId, r)), 3600);
      if (error) continue;
      Object.assign(out, buildBlobUrlMap(data.map((d: { path: string | null; signedUrl: string | null }) => ({ path: d.path ?? "", signedUrl: d.signedUrl })), batch));
    } catch {
      // Skip the batch.
    }
  }
  return out;
}

// POST /api/web-board/[orgId]/blob-urls with the visitor's cookie; null when it isn't there or fails.
async function serverUrls(orgId: string, refs: readonly string[]): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`/api/web-board/${orgId}/blob-urls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs }) });
    if (!res.ok) return null;
    const body = (await res.json()) as { urls?: Record<string, string> };
    return body.urls && typeof body.urls === "object" ? body.urls : null;
  } catch {
    return null;
  }
}

// The open thread's share of the channel: its item changes and reconnects (useCloudTransport's useLive listens).
function useItemBus() {
  const [listeners] = useState(() => new Set<Parameters<ItemBus["subscribe"]>[0]>());
  const bus = useMemo<ItemBus>(
    () => ({
      subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    }),
    [listeners],
  );
  const emit = useCallback((change: CloudItemChange | "reconnect") => {
    for (const l of listeners) {
      if (change === "reconnect") l.reconnect();
      else l.change(change);
    }
  }, [listeners]);
  return { bus, emit };
}

export function useWebBoard({ orgId, userId, initialCommands, initialCards, openCardId, initialBlobUrls }: WebBoardInput) {
  const [cards, setCards] = useState<CloudCardRow[]>(() => initialCards.map(openSyncedCard));
  const [activeCardId, setActiveCardId] = useState<string | null>(openCardId);
  const { bus, emit } = useItemBus();
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>(initialBlobUrls);
  const [commands, setCommands] = useState<CloudCommandRow[]>(initialCommands);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [client] = useState<SupabaseClient>(() => createBrowserClient(SUPABASE_URL, SUPABASE_KEY));
  // Refs already asked for, so one that never resolves isn't asked for again on every change.
  const asked = useRef(new Set(Object.keys(initialBlobUrls)));
  // Commands this tab sent: only these open their card when done, not one sent from another tab.
  const sent = useRef(new Set<string>());
  // The card a command made, to open once its row has synced back (the command is "done" a moment before that).
  const openWhenSeen = useRef<string | null>(null);

  // A browser paired from Settings → Sync opens sealed rows (lib/web-sync-key.ts): once its key is in, reopen the
  // cards already drawn and reload the open thread, which the first render drew as 🔒 like the server did.
  useEffect(() => {
    void loadWebKeyring(client, orgId, userId).then((opened) => {
      if (!opened) return;
      setCards((prev) => prev.map(openSyncedCard));
      emit("reconnect");
    });
  }, [client, orgId, userId, emit]);

  useEffect(() => {
    let cancelled = false;
    let subscribed = false;
    const channel: RealtimeChannel = client
      .channel(`web-board-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_cards", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudCardRow>(payload);
        if (cancelled || !change) return;
        const opened = change.new ? { ...change, new: openSyncedCard(change.new) } : change;
        setCards((prev) => applyCardChange(prev, opened as Parameters<typeof applyCardChange>[1]));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_thread_items", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudThreadItemRow>(payload);
        if (!cancelled && change) emit(change);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_commands", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudCommandRow>(payload);
        if (cancelled || !change) return;
        // A teammate's commands are theirs to follow.
        if (change.new && change.new.created_by !== userId) return;
        if (change.new?.status === "done" && change.new.card_id && sent.current.delete(change.new.id)) openWhenSeen.current = change.new.card_id;
        setCommands((prev) => applyCommandChange(prev, change as CloudCommandChange));
        // A reply, answer or stop that went shows in the thread now; its row has nothing left to say.
        if (change.new && isCardCommand(change.new) && change.new.status === "done") void client.from("cloud_commands").delete().eq("id", change.new.id);
      })
      .subscribe((status: string) => {
        if (cancelled) return;
        // Back after a drop: the open thread re-reads its newest page for what it missed.
        if (status === "SUBSCRIBED" && subscribed) emit("reconnect");
        if (status === "SUBSCRIBED") subscribed = true;
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
      });
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [client, orgId, userId, emit]);

  // Signs whatever refs have no URL yet: the cards' thumbnails here, the open thread's as it draws (CloudBlobContext).
  const requestBlobs = useCallback(
    (refs: string[]) => {
      const missing = refs.filter((r) => !asked.current.has(r));
      if (!missing.length) return;
      for (const r of missing) asked.current.add(r);
      void signedUrls(client, orgId, missing).then((map) => {
        if (Object.keys(map).length) setBlobUrls((prev) => ({ ...prev, ...map }));
      });
    },
    [client, orgId],
  );
  const thumbRefs = useMemo(() => cardThumbRefs(cards), [cards]);
  useEffect(() => requestBlobs(thumbRefs), [requestBlobs, thumbRefs]);
  const blobs = useMemo<Omit<CloudBlobs, "onShown">>(() => ({ urls: blobUrls, request: requestBlobs }), [blobUrls, requestBlobs]);

  const setCardParam = useCallback((cardId: string | null) => {
    const url = new URL(window.location.href);
    if (cardId) url.searchParams.set("card", cardId);
    else url.searchParams.delete("card");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Open a card, and put it in the URL so the panel is linkable and survives a refresh. Its thread view reads the
  // thread itself, through the transport.
  const openCard = useCallback(
    (cardId: string) => {
      setActiveCardId(cardId);
      setCardParam(cardId);
    },
    [setCardParam],
  );

  const closeCard = useCallback(() => {
    setActiveCardId(null);
    setCardParam(null);
  }, [setCardParam]);

  // Puts a command in for a Mac (lib/cloud-inbox.ts runs it). Resolves to the row, or why it couldn't be sent.
  const sendCommand = useCallback(
    async (row: NewCommand): Promise<CloudCommandRow | string> => {
      const { data, error } = await client.from("cloud_commands").insert(row).select().single<CloudCommandRow>();
      if (error) return error.message;
      setCommands((prev) => applyCommandChange(prev, { eventType: "INSERT", new: data, old: null }));
      return data;
    },
    [client],
  );

  // Asks the Mac that owns `target` to start a card. Resolves to why it couldn't be sent, or null once the command is
  // in; the card turns up on the board by itself when the Mac has made it.
  const startCard = useCallback(
    async (target: WebTarget, form: NewCardForm): Promise<string | null> => {
      const row = newCardCommand({ orgId, device: target.device, folder: target.folder }, form);
      if (!row) return "Write a prompt first.";
      const sentRow = await sendCommand(row);
      if (typeof sentRow === "string") return sentRow;
      sent.current.add(sentRow.id);
      return null;
    },
    [orgId, sendCommand],
  );

  // Asks the Mac that runs a card to send a reply in its thread, as if typed there. Resolves like startCard; the
  // message shows in the thread once the Mac has sent it.
  const sendReply = useCallback(
    async (row: CloudCardRow, text: string): Promise<string | null> => {
      const command = replyCommand({ orgId, device: row.owner_device, folder: row.folder, cardId: row.card_id }, text);
      if (!command) return "Write a message first.";
      const sentRow = await sendCommand(command);
      return typeof sentRow === "string" ? sentRow : null;
    },
    [orgId, sendCommand],
  );

  // The cards as they are now, so Stop can address a card's Mac without the transport changing each time a card does.
  const latest = useRef(cards);
  useEffect(() => {
    latest.current = cards;
  });
  const stopRow = useCallback(
    (cardId: string): NewCommand | string => {
      const row = latest.current.find((c) => c.card_id === cardId);
      return row ? stopCommand({ orgId, device: row.owner_device, folder: row.folder, cardId }) : "That thread isn't on the board anymore.";
    },
    [orgId],
  );
  const send = useCallback(async (row: NewCommand) => {
    const sentRow = await sendCommand(row);
    return typeof sentRow === "string" ? sentRow : null;
  }, [sendCommand]);
  const transport = useCloudTransport({ client, orgId, bus, stopCommand: stopRow, sendCommand: send });

  // Answers the card's waiting permission request or question on the Mac that runs it, as if clicked there. Resolves
  // like startCard; how it went shows under the reply box.
  const answer = useCallback(
    async (row: CloudCardRow, allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope): Promise<string | null> => {
      const pendingId = row.card.pending?.id;
      const command = pendingId && answerCommand({ orgId, device: row.owner_device, folder: row.folder, cardId: row.card_id }, { pendingId, allow, answers, reply, grant });
      return command ? send(command) : "Nothing is waiting for an answer.";
    },
    [orgId, send],
  );

  // Takes a command back before the Mac has run it, or clears one that failed. A delete the database refuses
  // leaves it where it is.
  const dropCommand = useCallback(
    async (id: string) => {
      const { error } = await client.from("cloud_commands").delete().eq("id", id);
      if (!error) setCommands((prev) => prev.filter((c) => c.id !== id));
    },
    [client],
  );

  // A started card opens as soon as it is on the board: when its command says done, or its row lands.
  useEffect(() => {
    const id = openWhenSeen.current;
    if (!id || !cards.some((c) => c.card_id === id)) return;
    openWhenSeen.current = null;
    openCard(id);
  }, [cards, commands, openCard]);

  // The full result of a tool call whose result was cut out of its item (cloud_tool_outputs).
  const toolOutput = useCallback(
    async (cardId: string, toolId: string) => {
      const { data, error } = await client
        .from("cloud_tool_outputs")
        .select("result")
        .eq("org_id", orgId)
        .eq("card_id", cardId)
        .eq("tool_id", toolId)
        .maybeSingle<{ result: string }>();
      if (error || !data) throw error ?? new Error("no output");
      return openSyncedTool({ org_id: orgId, card_id: cardId, tool_id: toolId, result: data.result });
    },
    [client, orgId],
  );

  // The cards as CardView draws them: a thumb ref becomes its signed URL once it has one.
  const shown = useMemo(() => withThumbUrls(cards, blobUrls), [cards, blobUrls]);

  return { cards: shown, commands, activeCardId, blobs, transport, live, openCard, closeCard, toolOutput, startCard, sendReply, answer, dropCommand };
}
