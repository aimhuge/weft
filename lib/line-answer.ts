"use client";

// Where a session line's sealed answer arrives (lib/session-line.ts): a Broadcast topic the board made up for this
// offer and sealed inside it, so only the worker knows where to answer. The board's own keyless client, as the screen's
// (lib/use-screen-stream.ts): the channel is public, the topic is the secret, and an answer that won't open is dropped.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANSWER_EVENT, type SealedAnswer } from "./rtc-signal";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-project";

type Realtime = Pick<SupabaseClient, "channel" | "removeChannel">;

let shared: Realtime | null = null;
const realtime = () => (shared ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));

export function listenForAnswer(topic: string, onAnswer: (sealed: SealedAnswer) => void, client: Realtime = realtime()): () => void {
  const channel = client
    .channel(topic)
    .on("broadcast", { event: ANSWER_EVENT }, ({ payload }) => onAnswer(payload as SealedAnswer))
    .subscribe();
  return () => void client.removeChannel(channel).catch(() => {});
}

// A topic nobody else can guess: 128 random bits.
export const lineToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
