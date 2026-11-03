import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountSettingsMessage, settingsDigest } from "./account-settings-sig";
import { macSigner } from "./mac-signer.harness";

// What a worker runs beside its inbox: the settings sync (only rows its paired Mac signed) and the limits.
vi.mock("./host-settings", () => ({ applyAccountSettings: vi.fn(() => []) }));
vi.mock("./limit-history", () => ({ readSamples: vi.fn(() => [{ at: 60_000, backend: "claude", kind: "five_hour", used: 5 }]) }));
vi.mock("./limit-poll", () => ({ startLimitPoll: vi.fn() }));
vi.mock("./model-limit", () => ({ modelLimits: vi.fn(() => [{ model: "claude-opus-5-5", at: 60_000, resetsAt: 1_800_000_000_000 }]) }));

const poll = await import("./limit-poll");
const host = await import("./host-settings");
const { settingsVersionAt, startHostServices } = await import("./worker-host-services");

const homes: string[] = [];
function home(macs?: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-host-services-"));
  homes.push(dir);
  if (macs) fs.writeFileSync(path.join(dir, "mac-keys.json"), JSON.stringify(macs));
  return dir;
}
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(host.applyAccountSettings).mockClear();
  for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const mac = macSigner();
function row(version: number, settings: unknown = { pushOnDone: false }, signer = mac) {
  return { user_id: "u-1", settings, version, signature: signer.sign(accountSettingsMessage("u-1", version, settingsDigest(settings))), updated_at: `t${version}` };
}

describe("startHostServices", () => {
  it("applies a row your paired Mac signed, starts the limit poll, and stops both", async () => {
    vi.useFakeTimers();
    const dir = home([mac.key]);
    const reg = { accountSettings: vi.fn(() => Promise.resolve(row(7))), setLimits: vi.fn(() => Promise.resolve()) };
    const services = startHostServices(reg, vi.fn(), dir);
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.accountSettings).toHaveBeenCalledTimes(1);
    expect(host.applyAccountSettings).toHaveBeenCalledWith({ pushOnDone: false });
    expect(settingsVersionAt(dir).read()).toBe(7);
    expect(poll.startLimitPoll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reg.setLimits).toHaveBeenCalledWith({ v: 1, s: [[1, "claude", 5, 5, 0]], m: [["claude-opus-5-5", 1, 1_800_000_000]] });
    services.nudge();
    services.stop();
    const calls = reg.accountSettings.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reg.accountSettings).toHaveBeenCalledTimes(calls);
  });

  it("refuses a row another key signed, an older one after a restart, and every row on a box that trusts no Mac", async () => {
    const log = vi.fn<(msg: string) => void>();
    const dir = home([mac.key]);
    settingsVersionAt(dir).write(9);
    for (const given of [row(10, { threadPrompt: "x" }, macSigner()), row(9)]) {
      const services = startHostServices({ accountSettings: () => Promise.resolve(given), setLimits: () => Promise.resolve() }, log, dir);
      await new Promise((r) => setTimeout(r, 0));
      services.stop();
    }
    const services = startHostServices({ accountSettings: () => Promise.resolve(row(11)), setLimits: () => Promise.resolve() }, log, home());
    await new Promise((r) => setTimeout(r, 0));
    services.stop();
    expect(host.applyAccountSettings).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([m]) => m)).toEqual([
      "Weft Worker: not taking your synced settings: the row's signature isn't your Mac's.",
      "Weft Worker: not taking your synced settings: the row is older than the settings this worker has.",
      expect.stringMatching(/trusts no Mac/),
    ]);
  });
});

describe("settingsVersionAt", () => {
  it("reads 0 when there's no file or it doesn't hold a number", () => {
    const dir = home();
    expect(settingsVersionAt(dir).read()).toBe(0);
    fs.writeFileSync(path.join(dir, "account-settings-version"), "1.5\n");
    expect(settingsVersionAt(dir).read()).toBe(0);
    settingsVersionAt(dir).write(42);
    expect(settingsVersionAt(dir).read()).toBe(42);
  });
});
