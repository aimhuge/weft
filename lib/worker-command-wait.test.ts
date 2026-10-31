import { describe, expect, it, vi } from "vitest";
import { waitForCommand, type CommandResult } from "./worker-command-wait";

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: (ms: number) => ((t += ms), Promise.resolve()) };
};
const is = (status: CommandResult["status"], error: string | null = null): CommandResult => ({ status, error });

describe("waitForCommand", () => {
  it("returns as soon as the command is done", async () => {
    const read = vi.fn<() => Promise<CommandResult>>().mockResolvedValueOnce(is("pending")).mockResolvedValueOnce(is("claimed")).mockResolvedValueOnce(is("done"));
    expect(await waitForCommand(read, clock())).toEqual(is("done"));
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("returns the failure with its reason", async () => {
    expect(await waitForCommand(() => Promise.resolve(is("failed", "no")), clock())).toEqual(is("failed", "no"));
  });

  it("stops waiting on a command nobody claims after a minute", async () => {
    const read = vi.fn(() => Promise.resolve(is("pending")));
    expect(await waitForCommand(read, clock())).toEqual(is("pending"));
    expect(read.mock.calls.length).toBeLessThan(35);
  });

  it("waits much longer once it's claimed", async () => {
    const read = vi.fn(() => Promise.resolve(is("claimed")));
    expect(await waitForCommand(read, clock())).toEqual(is("claimed"));
    expect(read.mock.calls.length).toBeGreaterThan(300);
  });

  it("rides out a failed read", async () => {
    const read = vi.fn<() => Promise<CommandResult>>().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce(is("done"));
    expect(await waitForCommand(read, clock())).toEqual(is("done"));
  });

  it("sleeps for real by default", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<CommandResult>>().mockResolvedValueOnce(is("pending")).mockResolvedValueOnce(is("done"));
    const done = waitForCommand(read);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await done).toEqual(is("done"));
    vi.useRealTimers();
  });
});
