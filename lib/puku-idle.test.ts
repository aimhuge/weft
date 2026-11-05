import { describe, expect, it } from "vitest";
import { backendEnv, idleToClose, keepAliveFor, MAX_IDLE_PUKU, PUKU_KEEP_ALIVE_MINUTES, refillsSpare } from "./puku-idle";
import { PUKU_BASH_ENV } from "./puku-dotenv";
import type { Backend } from "./types";

const s = (name: string, backend: Backend) => ({ name, spec: { backend } });
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("backendEnv", () => {
  it("turns off puku-cli's heap relaunch, so its once-a-second gc() never starts", () => {
    expect(backendEnv("puku")).toMatchObject({ PUKU_CLI_DISABLE_HEAP_RELAUNCH: "1" });
  });

  it("keeps a project's .env out of puku-cli's sign-in", () => {
    expect(backendEnv("puku", {})).toMatchObject({ PUKU_AI_API_KEY: "", PUKU_CLI_ENV_FILE: PUKU_BASH_ENV });
  });

  it("adds nothing for Claude Code", () => {
    expect(backendEnv("claude")).toEqual({});
  });

  it("returns a fresh object each time", () => {
    expect(backendEnv("puku")).not.toBe(backendEnv("puku"));
  });
});

describe("keepAliveFor", () => {
  it("keeps Claude Code's setting as is, including 0 for never", () => {
    expect(keepAliveFor("claude", false, 0)).toBe(0);
    expect(keepAliveFor("claude", false, 60)).toBe(60);
  });

  it("caps puku at 10 minutes, and gives it 10 when the setting is never", () => {
    expect(keepAliveFor("puku", false, 0)).toBe(PUKU_KEEP_ALIVE_MINUTES);
    expect(keepAliveFor("puku", false, 60)).toBe(PUKU_KEEP_ALIVE_MINUTES);
    expect(keepAliveFor("puku", false, 3)).toBe(3);
  });

  it("caps an imported session the same way", () => {
    expect(keepAliveFor("claude", true, 0)).toBe(10);
    expect(keepAliveFor("claude", true, 5)).toBe(5);
  });
});

describe("idleToClose", () => {
  it("closes nothing under both caps", () => {
    expect(idleToClose([s("a", "claude"), s("b", "puku"), s("c", "puku")], 8)).toEqual([]);
  });

  it("closes the oldest past the overall cap", () => {
    expect(names(idleToClose([s("a", "claude"), s("b", "claude"), s("c", "claude")], 2))).toEqual(["a"]);
  });

  it(`keeps at most ${MAX_IDLE_PUKU} idle puku CLIs, closing the oldest`, () => {
    const idle = [s("p1", "puku"), s("c1", "claude"), s("p2", "puku"), s("p3", "puku"), s("p4", "puku")];
    expect(names(idleToClose(idle, 8))).toEqual(["p1", "p2"]);
  });

  it("doesn't count a puku session the overall cap already closes", () => {
    const idle = [s("p1", "puku"), s("p2", "puku"), s("p3", "puku"), s("c1", "claude")];
    expect(names(idleToClose(idle, 3))).toEqual(["p1"]);
  });

  it("returns them oldest first", () => {
    const idle = [s("c1", "claude"), s("p1", "puku"), s("c2", "claude"), s("p2", "puku"), s("p3", "puku")];
    expect(names(idleToClose(idle, 4))).toEqual(["c1", "p1"]);
  });
});

describe("refillsSpare", () => {
  it("refills Claude Code spares but not puku ones", () => {
    expect(refillsSpare("claude")).toBe(true);
    expect(refillsSpare("puku")).toBe(false);
  });
});
