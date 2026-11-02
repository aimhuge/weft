import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const { workerLimitSamples } = await import("./worker-limits-read");

function client(answer: { data: unknown; error: unknown }) {
  const eq = vi.fn(() => ({ maybeSingle: () => Promise.resolve(answer) }));
  return { c: { from: () => ({ select: () => ({ eq }) }) } as unknown as SupabaseClient, eq };
}

describe("workerLimitSamples", () => {
  it("reads the worker's row and unpacks its history", async () => {
    const { c, eq } = client({ data: { limits: { v: 1, s: [[1, "claude", 7, 30, 0]] } }, error: null });
    expect(await workerLimitSamples("w1", c)).toEqual([{ at: 60_000, backend: "claude", kind: "seven_day", used: 30 }]);
    expect(eq).toHaveBeenCalledWith("id", "w1");
  });

  it("reads as no history when the row or the column isn't there", async () => {
    expect(await workerLimitSamples("w1", client({ data: null, error: null }).c)).toEqual([]);
    expect(await workerLimitSamples("w1", client({ data: null, error: { message: "column limits does not exist" } }).c)).toEqual([]);
    expect(await workerLimitSamples("w1", client({ data: { limits: null }, error: null }).c)).toEqual([]);
  });
});
