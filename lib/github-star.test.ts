import { describe, expect, it, vi } from "vitest";
import { starRepo, starStatus } from "./github-star";

const fail = (stderr: string) => Object.assign(new Error("Command failed: gh api"), { stderr });

describe("starStatus", () => {
  it("is true when GitHub answers 204", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "" });
    expect(await starStatus(exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith("gh", ["api", "user/starred/aimhuge/weft"], { timeout: 10_000 });
  });

  it("is false on a 404: not starred yet", async () => {
    expect(await starStatus(vi.fn().mockRejectedValue(fail("gh: Not Found (HTTP 404)")))).toBe(false);
  });

  it("is null when gh can't tell (signed out, missing, offline)", async () => {
    expect(await starStatus(vi.fn().mockRejectedValue(fail("gh auth login")))).toBeNull();
    expect(await starStatus(vi.fn().mockRejectedValue(new Error("spawn gh ENOENT")))).toBeNull();
    expect(await starStatus(vi.fn().mockRejectedValue("weird"))).toBeNull();
  });
});

describe("starRepo", () => {
  it("PUTs the star", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "" });
    expect(await starRepo(exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith("gh", ["api", "-X", "PUT", "user/starred/aimhuge/weft"], { timeout: 10_000 });
  });

  it("is false when gh fails", async () => {
    expect(await starRepo(vi.fn().mockRejectedValue(new Error("no")))).toBe(false);
  });
});
