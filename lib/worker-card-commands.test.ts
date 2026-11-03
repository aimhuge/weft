import { describe, expect, it } from "vitest";
import type { CloudCommandRow } from "./cloud-commands";
import { workerRules } from "./worker-card-commands";
import { applyGooseSettings } from "./host-goose-settings";
import type { Engine } from "./worker-daemon";
import type { WorkerWiden } from "./worker-widen";

const by = (created_by: string) => ({ created_by }) as CloudCommandRow;

describe("workerRules fromOwner", () => {
  it("is true only for a command the worker's owner made", () => {
    const rules = workerRules({} as Engine, { owner: "owner-1" });
    expect(rules.fromOwner?.(by("owner-1"))).toBe(true);
    expect(rules.fromOwner?.(by("teammate"))).toBe(false);
  });

  it("is false for everyone when the worker doesn't know its owner", () => {
    expect(workerRules({} as Engine).fromOwner?.(by(""))).toBe(false);
    expect(workerRules({} as Engine).fromOwner?.(by("owner-1"))).toBe(false);
  });
});

describe("workerRules goose", () => {
  it("takes Goose's provider only on a worker that checks signed widenings", () => {
    expect(workerRules({} as Engine).goose).toBeUndefined();
    expect(workerRules({} as Engine, { owner: "o", widen: {} as WorkerWiden }).goose).toBe(applyGooseSettings);
  });
});
