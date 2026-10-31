"use client";

// The board's side of a worker's live screen (lib/worker-screen.ts): joins the card's Broadcast topic and hands each
// JPEG to the view. Its own keyless client: the channel is public, the topic is the secret, and the desktop renderer
// has no Supabase session to use anyway.
import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
import { SCREEN_EVENT, screenTopic } from "./share-types";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-project";
import type { ScreenInput } from "./worker-commands";

export const frameSrc = (payload: unknown) => {
  const jpg = (payload as { jpg?: unknown } | null)?.jpg;
  return typeof jpg === "string" && jpg ? `data:image/jpeg;base64,${jpg}` : null;
};

export type Point = { x: number; y: number; px: number; py: number };

// Under this many pixels of travel a press is a tap, as on the desktop's live page (lib/simulator-viewer.ts).
const TAP_SLOP = 8;

export function gesture(device: string, down: Point, up: Point, ms: number): ScreenInput {
  if (Math.hypot(up.px - down.px, up.py - down.py) < TAP_SLOP) return { kind: "tap", device, x: down.x, y: down.y };
  return { kind: "swipe", device, x: down.x, y: down.y, x2: up.x, y2: up.y, ms: Math.min(1500, Math.max(100, ms)) };
}

export function useScreenStream(token: string, onFrame: (src: string) => void) {
  const latest = useRef(onFrame);
  useEffect(() => {
    latest.current = onFrame;
  });
  useEffect(() => {
    const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const channel = client
      .channel(screenTopic(token))
      .on("broadcast", { event: SCREEN_EVENT }, ({ payload }) => {
        const src = frameSrc(payload);
        if (src) latest.current(src);
      })
      .subscribe();
    return () => void client.removeChannel(channel).catch(() => {});
  }, [token]);
}
