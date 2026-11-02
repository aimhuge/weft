import { describe, expect, it } from "vitest";
import { holdWorkerCard, sentByWorker, WORKER_CARD_MODE, WORKER_CARD_TAG } from "./worker-origin";

describe("sentByWorker", () => {
  it("names the worker a row's stamp names, and nothing for the user's own rows", () => {
    expect(sentByWorker({ prompt: "p", fromWorker: "w-1" })).toBe("w-1");
    expect(sentByWorker({ prompt: "p" })).toBeNull();
    expect(sentByWorker({ fromWorker: "" })).toBeNull();
    expect(sentByWorker({ fromWorker: 7 })).toBeNull();
    expect(sentByWorker(null)).toBeNull();
    expect(sentByWorker("w-1")).toBeNull();
  });
});

describe("holdWorkerCard", () => {
  it("holds the card in Backlog in default, tagged once, whatever it asked for", () => {
    expect(holdWorkerCard({ prompt: "p", permissionMode: "bypassPermissions", tags: ["a", WORKER_CARD_TAG] })).toEqual({
      prompt: "p",
      permissionMode: WORKER_CARD_MODE,
      start: false,
      tags: ["a", WORKER_CARD_TAG],
    });
    expect(holdWorkerCard({ prompt: "p" })).toMatchObject({ start: false, tags: [WORKER_CARD_TAG] });
  });
});
