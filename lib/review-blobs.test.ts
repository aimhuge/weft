import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { withUploadedTour } from "./review-blobs";
import type { Card, ReviewPlan } from "./types";

const REF = `blob:sha256:${"a".repeat(64)}` as const;
// The test's home, like a worker's: the blob paths refuse anything outside it.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-tour-")));
const dir = path.join(home, "show");
fs.mkdirSync(dir);
const page = path.join(dir, "your todos.html");
fs.writeFileSync(page, "<title>t</title>");
const weird = path.join(dir, "a#b.html");
fs.writeFileSync(weird, "x");
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const card = (review?: ReviewPlan): Card => ({ id: "c1", title: "t", prompt: "", cwd: "/srv/app", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, review });
const store = (ref: string | null = REF) => ({ upload: vi.fn(() => Promise.resolve(null)), uploadPage: vi.fn(() => Promise.resolve(ref as typeof REF | null)) });

describe("withUploadedTour", () => {
  it("swaps a local step page for its uploaded copy, keeping the query and anchor", async () => {
    const blobs = store();
    const out = await withUploadedTour(card({ steps: [{ title: "a", path: `${page}?tab=2#done` }] }), blobs, "o1", home);
    expect(out.review?.steps[0]?.path).toBe(`${REF}?tab=2#done`);
    expect(blobs.uploadPage).toHaveBeenCalledWith(page, "o1");
  });

  it("takes a step's url and a page its look mentions too", async () => {
    const plan = { steps: [{ title: "a", path: page }, { title: "b", look: `See ${weird}.` }] };
    const out = await withUploadedTour(card(plan), store(), "o1", home);
    expect(out.review?.steps.map((s) => s.path)).toEqual([REF, REF]);
  });

  it("uploads through upload when the store has no uploadPage", async () => {
    const blobs = { upload: vi.fn(() => Promise.resolve(REF)) };
    const out = await withUploadedTour(card({ steps: [{ title: "a", path: page }] }), blobs, "o1", home);
    expect(out.review?.steps[0]?.path).toBe(REF);
  });

  it("keeps the card when no step names a file it can send", async () => {
    const tour = card({ url: "http://localhost:3000", steps: [{ title: "a", path: "/login" }, { title: "b", path: "https://example.com" }, { title: "c", path: `${dir}/gone.html` }] });
    const blobs = store();
    expect(await withUploadedTour(tour, blobs, "o1", home)).toBe(tour);
    expect(blobs.uploadPage).not.toHaveBeenCalled();
  });

  it("keeps a step's path when the store refuses the file", async () => {
    const tour = card({ steps: [{ title: "a", path: page }] });
    expect(await withUploadedTour(tour, store(null), "o1", home)).toBe(tour);
  });

  it("leaves a card without a tour alone", async () => {
    const plain = card();
    expect(await withUploadedTour(plain, store(), "o1", home)).toBe(plain);
    const pageless = card({ steps: [{ title: "a" }] });
    expect(await withUploadedTour(pageless, store(), "o1", home)).toBe(pageless);
  });
});
