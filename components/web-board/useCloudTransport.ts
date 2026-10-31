"use client";

// weft.zip's thread transport (lib/thread-transport.ts), so an open card is the desktop's own ThreadPanel, ThreadView
// and ReplyBox: pages read from cloud_thread_items through the visitor's session (RLS gates them), live changes from
// the board's one Realtime channel (useWebBoard hands them on through `bus`), blob refs signed as the items draw (the
// URLs come through CloudBlobContext, so a URL landing redraws the items without making a new transport), and
// Stop sent as a command for the Mac that runs the card (lib/cloud-inbox.ts). What only the Mac itself can do (a "!"
// command, ↑ edit, Wait, a subagent's Stop) is left out, so its views don't offer it. Folder grants go inside the answer.
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewCommand } from "@/lib/cloud-commands";
import { THREAD_PAGE_SIZE, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows, pageUpdateFor, type CloudItemChange } from "@/lib/cloud-thread-page";
import type { PageUpdate, ThreadTransport } from "@/lib/thread-transport";
import type { ThreadItem } from "@/lib/types";
import { collectBlobRefs, rewriteBlobRefs } from "@/lib/web-board";

// Where useWebBoard's channel sends thread item changes, and its reconnects, to the open thread.
export interface ItemBus {
  subscribe(listener: { change: (change: CloudItemChange) => void; reconnect: () => void }): () => void;
}

// Signed URLs by blob ref, a request for the refs that have none yet, and where the items the open thread draws go
// (the board's pane follows them: WebThreadPanel's paneFor).
export interface CloudBlobs {
  urls: Record<string, string>;
  request: (refs: string[]) => void;
  onShown: (items: ThreadItem[]) => void;
}

export const CloudBlobContext = createContext<CloudBlobs>({ urls: {}, request: () => {}, onShown: () => {} });

export interface CloudTransportInput {
  client: SupabaseClient;
  orgId: string;
  bus: ItemBus;
  // Puts a command in for the Mac that runs the card; resolves to why it couldn't, or null.
  stopCommand: (cardId: string) => NewCommand | string;
  sendCommand: (row: NewCommand) => Promise<string | null>;
}

function useCloudLive(bus: ItemBus, cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void) {
  const handlers = useRef({ onUpdate, onReconnect });
  useEffect(() => {
    handlers.current = { onUpdate, onReconnect };
  });
  useEffect(
    () =>
      bus.subscribe({
        change: (change) => {
          const update = pageUpdateFor(cardId, change);
          if (update) handlers.current.onUpdate(update);
        },
        reconnect: () => handlers.current.onReconnect(),
      }),
    [bus, cardId],
  );
}

// The items with their blob refs as signed URLs; a ref that has none yet is asked for, and shows once it lands.
function useCloudView(items: ThreadItem[]) {
  const { urls, request, onShown } = useContext(CloudBlobContext);
  useEffect(() => onShown(items), [items, onShown]);
  const refs = useMemo(() => {
    const found = new Set<string>();
    collectBlobRefs(items, found);
    return [...found];
  }, [items]);
  useEffect(() => {
    if (refs.length) request(refs);
  }, [refs, request]);
  return useMemo(() => rewriteBlobRefs(items, urls), [items, urls]);
}

export function useCloudTransport({ client, orgId, bus, stopCommand, sendCommand }: CloudTransportInput): ThreadTransport {
  return useMemo<ThreadTransport>(
    () => ({
      async loadPage(cardId, before) {
        let query = client.from("cloud_thread_items").select("card_id, seq, item").eq("org_id", orgId).eq("card_id", cardId);
        if (before !== undefined) query = query.lt("seq", before);
        const { data, error } = await query.order("seq", { ascending: false }).limit(THREAD_PAGE_SIZE).overrideTypes<CloudThreadItemRow[]>();
        return error ? null : pageFromRows(cardId, data);
      },
      useLive(cardId, onUpdate, onReconnect) {
        useCloudLive(bus, cardId, onUpdate, onReconnect);
      },
      useView: useCloudView,
      async stop(cardId) {
        const row = stopCommand(cardId);
        const failed = typeof row === "string" ? row : await sendCommand(row);
        if (failed) throw new Error(failed);
      },
      grantInAnswer: true,
      desktop: false,
    }),
    [client, orgId, bus, stopCommand, sendCommand],
  );
}
