"use client";

// A worker card's pictures on the desktop board. A synced thread names an image by its blob ref (`blob:sha256:<hex>`:
// a screenshot a tool returned, a picture pasted in a message), which no <img> can load and lib/media.ts can't show.
// weft.zip signs them in the browser (components/web-board/useCloudTransport.ts useCloudView); a worker card's thread
// has no Supabase client in the renderer, so its view asks this Mac's server for them signed (GET /api/worker-board
// ?blobs=, lib/worker-thread-reads.ts) and draws each one once its URL lands. Only pictures are rewritten: a page ref
// (an open_url's `blob:…#anchor`, a message's `page`) stays a ref, which the show rail and the pane frame themselves.
// The rail gets the items as they came (lib/worker-shown.ts).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import { isBlobRef } from "./cloud-sync-types";
import type { ThreadItem } from "./types";
import { batchBlobRefs } from "./web-board";
import { useShownItems } from "./worker-shown";

// A Markdown image whose target is a blob ref: `![alt](blob:sha256:<hex>)` or `![alt](<blob:sha256:<hex>>)`.
const IMAGE_REF = /(!\[[^\]\n]*\]\(<?)(blob:sha256:[0-9a-f]{64})/g;

// A signed URL holds an hour (lib/blob-urls.ts); one is asked for again a little before that.
export const URL_TTL_MS = 50 * 60_000;

const textRefs = (text: string) => [...text.matchAll(IMAGE_REF)].map((m) => m[2] as string);

function itemRefs(item: ThreadItem): string[] {
  if (item.kind === "user" || item.kind === "assistant") return textRefs(item.text);
  if (item.kind === "tool") return (item.images ?? []).filter(isBlobRef);
  if (item.kind === "edited") return item.items.flatMap(itemRefs);
  return [];
}

// The picture refs in a thread's items, once each.
export const imageRefs = (items: readonly ThreadItem[]): string[] => [...new Set(items.flatMap(itemRefs))];

function withUrls(item: ThreadItem, urls: Record<string, string>): ThreadItem {
  const text = (t: string) => t.replace(IMAGE_REF, (whole, head: string, ref: string) => (urls[ref] ? `${head}${urls[ref]}` : whole));
  if (item.kind === "user" || item.kind === "assistant") return { ...item, text: text(item.text) };
  if (item.kind === "tool" && item.images) return { ...item, images: item.images.map((src) => urls[src] ?? src) };
  if (item.kind === "edited") return { ...item, items: item.items.map((i) => withUrls(i, urls)) };
  return item;
}

// The items with each picture ref that has a URL drawn from it; an item with none is the same object, and so is the
// list when none has one.
export function withImageUrls(items: ThreadItem[], urls: Record<string, string>): ThreadItem[] {
  const out = items.map((item) => (itemRefs(item).some((ref) => urls[ref]) ? withUrls(item, urls) : item));
  return out.some((item, i) => item !== items[i]) ? out : items;
}

// The URLs signed so far, one object per change so a view redraws when one lands.
let urls: Record<string, string> = {};
const until = new Map<string, number>();
const asking = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function sign(refs: string[], now: number) {
  try {
    const res = await apiFetch(`/api/worker-board?${new URLSearchParams({ blobs: refs.join(",") }).toString()}`);
    if (!res.ok) return;
    const got = ((await res.json()) as { urls?: Record<string, string> }).urls ?? {};
    for (const ref of Object.keys(got)) until.set(ref, now + URL_TTL_MS);
    if (!Object.keys(got).length) return;
    urls = { ...urls, ...got };
    for (const listener of [...listeners]) listener();
  } catch {
    // No server or no network: the picture stays a ref until the thread draws again.
  } finally {
    for (const ref of refs) asking.delete(ref);
  }
}

// Asks for the refs that have no URL yet (or an old one), in batches; resolves once every batch has answered.
export function requestBlobUrls(refs: readonly string[], now = Date.now()): Promise<void> {
  const missing = refs.filter((ref) => !asking.has(ref) && (until.get(ref) ?? 0) <= now);
  for (const ref of missing) asking.add(ref);
  return Promise.all(batchBlobRefs(missing).map((batch) => sign(batch, now))).then(() => {});
}

// For tests: forget every URL.
export function forgetBlobUrls() {
  urls = {};
  until.clear();
  asking.clear();
}

// The worker transport's useView: the items with their pictures signed, and the items as they came to the show rail.
export function useWorkerView(items: ThreadItem[]): ThreadItem[] {
  useShownItems(items);
  const signed = useSyncExternalStore(subscribe, () => urls, () => urls);
  const refs = useMemo(() => imageRefs(items), [items]);
  useEffect(() => {
    if (refs.length) void requestBlobUrls(refs);
  }, [refs]);
  return useMemo(() => withImageUrls(items, signed), [items, signed]);
}
