import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./telemetry-send", () => ({ forwardOnboarding: vi.fn(() => Promise.resolve(false)) }));

const { trackActivation, ACTIVATION_FILE } = await vi.importActual<typeof import("./activation")>("./activation");

let file: string;
const send = vi.fn(() => Promise.resolve(true));
const day = (d: string) => new Date(`${d}T10:00:00`).getTime();

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "activation-")), "nested", "activation.json");
  send.mockClear();
});

describe("trackActivation", () => {
  it("lives in Weft's data folder", () => {
    expect(ACTIVATION_FILE.endsWith("activation.json")).toBe(true);
  });

  it("sends the first card once, with its backend", async () => {
    expect(await trackActivation("card", { backend: "claude" }, { file, send })).toBe(true);
    expect(await trackActivation("card", { backend: "codex" }, { file, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("activation_first_card", { backend: "claude" });
  });

  it("sends the first Done once, with the minutes since the first card", async () => {
    await trackActivation("card", undefined, { file, send, now: 0 });
    expect(await trackActivation("done", {}, { file, send, now: 90 * 60000 })).toBe(true);
    expect(await trackActivation("done", {}, { file, send })).toBe(false);
    expect(send).toHaveBeenLastCalledWith("activation_first_done", { minutes_since_first_card: 90 });
  });

  it("says -1 minutes for a Done with no first card on record", async () => {
    await trackActivation("done", {}, { file, send });
    expect(send).toHaveBeenCalledWith("activation_first_done", { minutes_since_first_card: -1 });
  });

  it("pings once per local day, saying whether a card was ever Done", async () => {
    expect(await trackActivation("day", {}, { file, send, now: day("2026-11-14") })).toBe(true);
    expect(await trackActivation("day", {}, { file, send, now: day("2026-11-14") + 3600000 })).toBe(false);
    await trackActivation("done", {}, { file, send });
    expect(await trackActivation("day", {}, { file, send, now: day("2026-11-15") })).toBe(true);
    expect(send).toHaveBeenNthCalledWith(1, "desktop_active_day", { has_done: false });
    expect(send).toHaveBeenLastCalledWith("desktop_active_day", { has_done: true });
  });

  it("starts over from an unreadable file", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(await trackActivation("card", {}, { file, send })).toBe(true);
  });

  it("goes through the onboarding forwarder and Weft's own file by default", async () => {
    const { forwardOnboarding } = await import("./telemetry-send");
    expect(await trackActivation("day")).toBe(false);
    expect(forwardOnboarding).toHaveBeenCalledWith("desktop_active_day", { has_done: false });
  });
});
