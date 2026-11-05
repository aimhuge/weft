// A host verb's value in its result (lib/host-result.ts): inline under the row's cap, else a blob named by its sha,
// and read back either way.
import { describe, expect, it, vi } from "vitest";
import { INLINE_MAX, carriesValue, resultValue, valueResult } from "./host-result";

const SHA = "cd".repeat(32);

describe("valueResult", () => {
  it("keeps a small value, null included, in the row", async () => {
    await expect(valueResult("c1", { files: [] }, undefined)).resolves.toEqual({ ok: true, cardId: "c1", value: { files: [] } });
    await expect(valueResult("c1", undefined, undefined)).resolves.toEqual({ ok: true, cardId: "c1", value: null });
  });

  it("carries one over the cap as JSON", async () => {
    const carry = vi.fn(() => Promise.resolve(SHA));
    const big = { text: "x".repeat(INLINE_MAX) };
    await expect(valueResult("c1", big, carry)).resolves.toEqual({ ok: true, cardId: "c1", blob: SHA });
    expect(carry).toHaveBeenCalledWith(JSON.stringify(big));
    await expect(valueResult("c1", big, undefined)).rejects.toThrow("can't send a large result");
  });
});

describe("resultValue", () => {
  it("reads a blob's JSON, or the inline value", async () => {
    const read = vi.fn(() => Promise.resolve('{"files":["a.ts"]}'));
    await expect(resultValue({ ok: true, blob: SHA }, read)).resolves.toEqual({ files: ["a.ts"] });
    expect(read).toHaveBeenCalledWith(SHA);
    await expect(resultValue({ ok: true, value: 3 }, read)).resolves.toBe(3);
  });

  it("refuses a blob that isn't there, and ignores one that isn't a sha", async () => {
    await expect(resultValue({ blob: SHA }, () => Promise.resolve(null))).rejects.toThrow("isn't in the blob store");
    const read = vi.fn();
    await expect(resultValue({ blob: "../../etc", value: 1 }, read)).resolves.toBe(1);
    await expect(resultValue(null, read)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});

it("names the editor's verbs as the ones that answer with a value", () => {
  expect(carriesValue("files.read")).toBe(true);
  expect(carriesValue("card.stop")).toBe(false);
});
