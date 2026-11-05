// The board's session line repairing itself (lib/session-line.ts): an ICE restart over the line, dropping to the relay
// when that can't get through, and renegotiating media over the line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_MS, BEAT_MS, DEAD_MS, RENEGOTIATE_MS, RETRY_MS } from "./session-line";
import { LineDown } from "./session-line-calls";
import { flush, fresh, last, seen, up } from "./session-line.harness";

beforeEach(fresh);
afterEach(() => vi.useRealTimers());

describe("repair", () => {
  it("restarts ICE over the line when no pong comes, and stays up when it gets through", async () => {
    await up();
    const pc = last();
    seen.t += DEAD_MS + 1;
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(pc.offers.at(-1)).toEqual({ iceRestart: true });
    const sent = pc.channels.line!.sent.at(-1);
    expect(sent).toEqual({ t: "offer", sdp: "offer 2" });
    // ICE saying disconnected while it's repairing doesn't start another.
    pc.state("disconnected");
    await flush();
    expect(pc.offers).toHaveLength(2);
    pc.channels.line!.msg({ t: "answer", sdp: "restarted" });
    await flush();
    expect(pc.remote.at(-1)).toEqual({ type: "answer", sdp: "restarted" });
    expect(pc.closed).toBe(false);
  });

  it("drops the line and opens it again through Supabase when the restart can't get through", async () => {
    const { line, deps } = await up();
    const pc = last();
    pc.state("disconnected");
    await vi.advanceTimersByTimeAsync(RENEGOTIATE_MS);
    expect(pc.closed).toBe(true);
    expect(line.route()).toEqual({ kind: "relay" });
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(deps.offer).toHaveBeenCalledTimes(2);
  });

  it("drops the line when the worker refuses the restart, or the line fails or closes", async () => {
    for (const end of ["error", "failed", "closed", "channel"] as const) {
      seen.pcs = [];
      const { line } = await up();
      const pc = last();
      const lost = line.call("card.stop", { id: "c" }).catch((err: unknown) => (err as Error).message);
      if (end === "error") {
        pc.state("disconnected");
        await flush();
        pc.channels.line!.msg({ t: "error", message: "no" });
        await flush();
      } else if (end === "channel") pc.channels.host!.close();
      else pc.state(end);
      expect(await lost).toMatch("dropped");
      expect(line.route()).toEqual({ kind: "relay" });
      line.close();
    }
  });

  it("ignores what an old peer says once a new one has replaced it", async () => {
    const { deps } = await up();
    const old = last();
    old.state("failed");
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(deps.offer).toHaveBeenCalledTimes(2);
    old.state("closed");
    old.state("connected");
    old.channels.host!.close();
    old.channels.host!.open();
    await vi.advanceTimersByTimeAsync(ANSWER_MS - 1);
    expect(deps.offer).toHaveBeenCalledTimes(2);
  });
});

describe("renegotiation", () => {
  it("adds media over the line with its screen, one offer at a time, and refuses when the line is down", async () => {
    const { line } = await up();
    const pc = last();
    const add = vi.fn();
    const first = line.renegotiate(add, { device: "sim", quality: "low", channel: "input:sim:1" });
    const second = line.renegotiate(vi.fn());
    await flush();
    expect(add).toHaveBeenCalledWith(pc);
    expect(pc.channels.line!.sent.at(-1)).toEqual({ t: "offer", sdp: "offer 2", screen: { device: "sim", quality: "low", channel: "input:sim:1" } });
    pc.channels.line!.msg({ t: "answer", sdp: "a2" });
    await first;
    await flush();
    pc.channels.line!.msg({ t: "answer", sdp: "a3" });
    await second;
    expect(pc.remote.slice(-2)).toEqual([{ type: "answer", sdp: "a2" }, { type: "answer", sdp: "a3" }]);
    pc.noSdp = true;
    const bare = line.renegotiate(vi.fn());
    await flush();
    expect(pc.channels.line!.sent.at(-1)).toEqual({ t: "offer", sdp: "" });
    pc.channels.line!.msg({ t: "answer", sdp: "a4" });
    await bare;
    line.close();
    await expect(line.renegotiate(vi.fn())).rejects.toBeInstanceOf(LineDown);
    expect(line.route()).toEqual({ kind: "relay" });
  });
});
