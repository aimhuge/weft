import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMissingRepo, isMissingRepo, putWithRepo } from "./cloud-cards-repo";
import { UploadError } from "./cloud-sync-send";

const missing = () => new UploadError("Could not find the 'repo' column of 'cloud_cards' in the schema cache", "PGRST204");

beforeEach(forgetMissingRepo);

describe("isMissingRepo", () => {
  it("is only the schema cache's missing repo column", () => {
    expect(isMissingRepo(missing())).toBe(true);
    expect(isMissingRepo(new UploadError("Could not find the 'page' column", "PGRST204"))).toBe(false);
    expect(isMissingRepo(new UploadError("Could not find the 'repo' column", "22P02"))).toBe(false);
    expect(isMissingRepo(new Error("Could not find the 'repo' column"))).toBe(false);
  });
});

describe("putWithRepo", () => {
  it("sends the rows as they are on a database with the column", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await putWithRepo(put, [{ card_id: "a", repo: "o/r" }]);
    expect(put).toHaveBeenCalledWith([{ card_id: "a", repo: "o/r" }]);
  });

  it("sends them again without repo, and leaves it out from then on", async () => {
    const put = vi.fn().mockRejectedValueOnce(missing()).mockResolvedValue(undefined);
    await putWithRepo(put, [{ card_id: "a", repo: "o/r" }]);
    expect(put.mock.calls).toEqual([[[{ card_id: "a", repo: "o/r" }]], [[{ card_id: "a" }]]]);
    await putWithRepo(put, [{ card_id: "b", repo: "o/r" }]);
    expect(put).toHaveBeenLastCalledWith([{ card_id: "b" }]);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("throws any other error", async () => {
    const put = vi.fn().mockRejectedValue(new UploadError("nope", "42501"));
    await expect(putWithRepo(put, [{ repo: "o/r" }])).rejects.toThrow("nope");
    expect(put).toHaveBeenCalledTimes(1);
  });
});
