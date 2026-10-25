import { afterEach, describe, expect, it, vi } from "vitest";

const { append } = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock("./activity", () => ({ append }));

const { recordExplore } = await import("./explore");

afterEach(() => {
  append.mockReset();
  vi.restoreAllMocks();
});

describe("recordExplore", () => {
  it("logs the feature under an id of its own, so the log keeps one", async () => {
    await recordExplore("vault", 5);
    expect(append).toHaveBeenCalledWith([{ id: "explore:vault", at: 5, kind: "explore", feature: "vault" }]);
  });

  it("dates it now by default", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    await recordExplore("intro:leagues");
    expect((append.mock.calls[0] as unknown[][] | undefined)?.[0]?.[0]).toMatchObject({ id: "explore:intro:leagues", at: 42 });
  });

  it("warns instead of throwing when the log can't be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    append.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(recordExplore("webhook")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Couldn't write the activity log", expect.any(Error));
  });
});
