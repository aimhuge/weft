import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-feedback-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));

const { feedbackDir, saveFeedback } = await import("./feedback-store");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("saveFeedback", () => {
  it("writes one JSON file per summary under ~/.weft/feedback", () => {
    const entry = { id: "abc", at: Date.UTC(2026, 9, 25, 3, 30), summary: { title: "T", body: "B" }, messages: [{ role: "user" as const, text: "hi" }], from: null, version: "1.0.0", sent: false };
    const file = saveFeedback(entry);
    expect(path.dirname(file)).toBe(feedbackDir());
    expect(path.basename(file)).toBe("2026-10-25T03-30-00-000Z-abc.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(entry);
  });
});
