// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The board's side of the format handshake: once joined, it tells the worker it draws WebP (lib/screen-formats.ts).
const rt = vi.hoisted(() => {
  const handlers: Record<string, (msg: { payload: unknown }) => void> = {};
  const held = { status: (() => {}) as (status: string) => void };
  const track = vi.fn(() => Promise.reject(new Error("closed")));
  const removeChannel = vi.fn(() => Promise.reject(new Error("gone")));
  const channel = {
    on: (_type: string, filter: { event: string }, cb: (msg: { payload: unknown }) => void) => ((handlers[filter.event] = cb), channel),
    subscribe: (cb: (status: string) => void) => ((held.status = cb), channel),
    track,
  };
  return { handlers, held, track, removeChannel, client: { channel: vi.fn(() => channel), removeChannel } };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => rt.client, REALTIME_SUBSCRIBE_STATES: { SUBSCRIBED: "SUBSCRIBED" } }));

const { useScreenStream } = await import("./use-screen-stream");

describe("useScreenStream", () => {
  it("announces WebP once joined, draws either format, hands answers on, and leaves on unmount", () => {
    const onFrame = vi.fn();
    const onAnswer = vi.fn();
    const { unmount } = renderHook(() => useScreenStream("tok", onFrame, onAnswer));
    expect(rt.client.channel).toHaveBeenCalledWith("worker-screen:tok");
    rt.held.status("CHANNEL_ERROR");
    expect(rt.track).not.toHaveBeenCalled();
    rt.held.status("SUBSCRIBED");
    expect(rt.track).toHaveBeenCalledWith({ formats: ["webp", "jpeg"] });
    rt.handlers.frame!({ payload: { webp: "w" } });
    rt.handlers.frame!({ payload: { nothing: true } });
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith("data:image/webp;base64,w");
    rt.handlers.answer!({ payload: { sealed: 1 } });
    expect(onAnswer).toHaveBeenCalledWith({ sealed: 1 });
    unmount();
    expect(rt.removeChannel).toHaveBeenCalled();
  });
});
