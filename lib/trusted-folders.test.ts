// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFolder, revokeFolder } from "./trusted-folders";

const api = vi.hoisted(() => ({
  allowFolder: vi.fn(() => Promise.resolve({ ok: true as const })),
  unallowFolder: vi.fn(() => Promise.resolve({ ok: true as const })),
}));
vi.mock("@/lib/client", () => ({ api }));

const DOWNLOADS = "/Users/me/Downloads";
const openFolder = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

beforeEach(() => {
  vi.clearAllMocks();
  api.allowFolder.mockResolvedValue({ ok: true });
  api.unallowFolder.mockResolvedValue({ ok: true });
  openFolder.mockResolvedValue(null);
  window.weft = { dialog: { openFolder } } as unknown as typeof window.weft;
});

afterEach(() => {
  delete (window as { weft?: unknown }).weft;
});

describe("revokeFolder", () => {
  it("takes the folder back out through DELETE /api/folders", async () => {
    await revokeFolder(DOWNLOADS);
    expect(api.unallowFolder).toHaveBeenCalledWith(DOWNLOADS);
  });

  it("passes the server's rejection on rather than swallowing it", async () => {
    api.unallowFolder.mockRejectedValue(new Error("nope"));
    await expect(revokeFolder(DOWNLOADS)).rejects.toThrow("nope");
  });
});

describe("addFolder", () => {
  it("grants the folder the OS dialog picked and returns it", async () => {
    openFolder.mockResolvedValue(DOWNLOADS);
    await expect(addFolder()).resolves.toBe(DOWNLOADS);
    // The same call the "Always" button on a folder-guard prompt makes, so both doors land in one place.
    expect(api.allowFolder).toHaveBeenCalledWith(DOWNLOADS);
  });

  it("resolves null and grants nothing when the dialog is cancelled", async () => {
    openFolder.mockResolvedValue(null);
    await expect(addFolder()).resolves.toBeNull();
    expect(api.allowFolder).not.toHaveBeenCalled();
  });

  it("says so when there's no Electron bridge, pointing at the Always path", async () => {
    delete (window as { weft?: unknown }).weft;
    await expect(addFolder()).rejects.toThrow(/Always on a thread's folder prompt/);
    expect(api.allowFolder).not.toHaveBeenCalled();
  });

  it("passes a failed grant on rather than reporting the folder as added", async () => {
    openFolder.mockResolvedValue(DOWNLOADS);
    api.allowFolder.mockRejectedValue(new Error("nope"));
    await expect(addFolder()).rejects.toThrow("nope");
  });
});