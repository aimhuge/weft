"use client";

// weft.zip's thread transport (lib/thread-transport.ts), so an open card is the desktop's own ThreadPanel, ThreadView
// and ReplyBox: pages read from cloud_thread_items through the visitor's session (RLS gates them), live changes from
// the board's one Realtime channel (useWebBoard hands them on through `bus`), blob refs signed as the items draw (the
// URLs come through CloudBlobContext, so a URL landing redraws the items without making a new transport), and
// Stop sent as a command for the Mac that runs the card (lib/cloud-inbox.ts). ↑ edit, Send fresh, Send later, the "/"
// list, Wait / This first / Others first and a subagent's Stop go as host verbs to whichever machine runs it
// (lib/cloud-host-acts.ts), and so does every card edit the board makes: the same acts are the board's one host for every
// card (lib/web-host.ts). Pasted files go up to the workspace's blobs (lib/web-upload.ts) and travel on the row. Find
// covers the whole thread (lib/cloud-thread-search.ts). What widens what a card can touch (a "!" command, a folder grant
// outside an answer) is left out, so its views don't offer it; folder grants go inside the answer.
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stopCommand, type NewCommand } from "@/lib/cloud-commands";
import { cloudHostActs, type CardTarget, type CloudHostActs } from "@/lib/cloud-host-acts";
import { BLOB_BUCKET, THREAD_PAGE_SIZE, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows, pageUpdateFor, type CloudItemChange } from "@/lib/cloud-thread-page";
import { SEARCH_BATCH, searchCloudThread } from "@/lib/cloud-thread-search";
import { firstNow, otherFirstNow, stopNow, waitNow } from "@/lib/optimistic-cards";
import type { ProjectHost } from "@/lib/project-host";
import type { PageUpdate, ThreadTransport } from "@/lib/thread-transport";
import type { ToolResultSource } from "@/lib/use-tool-result";
import { webHost } from "@/lib/web-host";
import { webUploads, type WebUploads } from "@/lib/web-upload";
import type { ThreadItem } from "@/lib/types";
import type { CommandResult } from "@/lib/worker-command-wait";
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
  // Where the card runs, to address a command to, or why it can't be.
  target: (cardId: string) => CardTarget | string;
  // Puts a command in for the machine that runs the card; resolves to its id, or why it couldn't be sent.
  sendCommand: (row: NewCommand) => Promise<{ id: string } | string>;
  // Where the composer's pasted files go (webUploadsFor).
  uploads: WebUploads;
  // The full result of a trimmed tool call, for the host's `tools`.
  tools: ToolResultSource;
}

// The visitor's pasted files, up to the workspace's blobs as them; one already there counts as uploaded.
export function webUploadsFor(client: SupabaseClient, orgId: string): WebUploads {
  return webUploads({
    put: async (sha, bytes, mime) => {
      const { error } = await client.storage.from(BLOB_BUCKET).upload(`${orgId}/${sha}`, bytes, { contentType: mime, upsert: false });
      return !error || /exists|duplicate/i.test(error.message) ? null : error.message;
    },
  });
}

// The card's rows past seq `after`, oldest first, for ⌘F over the whole thread.
function rowsAfter(client: SupabaseClient, orgId: string, cardId: string) {
  return async (after: number) => {
    const { data, error } = await client
      .from("cloud_thread_items")
      .select("card_id, seq, item")
      .eq("org_id", orgId)
      .eq("card_id", cardId)
      .gt("seq", after)
      .order("seq", { ascending: true })
      .limit(SEARCH_BATCH)
      .overrideTypes<CloudThreadItemRow[]>();
    return error ? null : data;
  };
}

// How a command went, read with the visitor's session (RLS: their own rows).
async function readCommand(client: SupabaseClient, id: string): Promise<CommandResult> {
  const { data, error } = await client.from("cloud_commands").select("status, error, result").eq("id", id).maybeSingle<CommandResult>();
  if (error || !data) throw new Error(error?.message ?? "That command is gone.");
  return data;
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

// The held-edit choices and a subagent's Stop, as host verbs, drawn at once (lib/optimistic-cards.ts).
function holds(acts: CloudHostActs): Pick<ThreadTransport, "waitPermission" | "putFirst" | "putHolderFirst" | "stopTask"> {
  return {
    waitPermission: (cardId, pendingId) => waitNow(cardId, pendingId, () => acts.act("card.permission.wait", cardId, { pendingId })),
    putFirst: (cardId, pendingId) => firstNow(cardId, pendingId, () => acts.act("card.permission.first", cardId, { pendingId })),
    putHolderFirst: (cardId, pendingId) => otherFirstNow(cardId, pendingId, () => acts.act("card.permission.otherFirst", cardId, { pendingId })),
    stopTask: (cardId, taskId) => acts.act("card.stopTask", cardId, { taskId }).then(() => {}),
  };
}

// The open thread's transport, and the host every card on the board has (lib/web-host.ts), over the same acts.
export function useCloudTransport({ client, orgId, bus, target, sendCommand, uploads, tools }: CloudTransportInput): { transport: ThreadTransport; host: ProjectHost } {
  return useMemo(() => {
    const acts = cloudHostActs({ target, insert: sendCommand, read: (id) => readCommand(client, id) });
    const transport: ThreadTransport = {
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
      searchThread: (cardId, query) => searchCloudThread(cardId, query, rowsAfter(client, orgId, cardId)),
      // Out of Running at once, as the tile's and the menu's Stop (lib/optimistic-cards.ts).
      stop: (cardId) =>
        stopNow(cardId, async () => {
          const to = target(cardId);
          const sent = typeof to === "string" ? to : await sendCommand(stopCommand(to));
          if (typeof sent === "string") throw new Error(sent);
        }),
      editLast: acts.editLast,
      fresh: acts.fresh,
      schedule: acts.schedule,
      unschedule: acts.unschedule,
      listSkills: acts.listSkills,
      ...holds(acts),
      upload: uploads.upload,
      grantInAnswer: true,
      cardEdits: true,
      desktop: false,
    };
    return { transport, host: webHost(acts, transport, tools) };
  }, [client, orgId, bus, target, sendCommand, uploads, tools]);
}
