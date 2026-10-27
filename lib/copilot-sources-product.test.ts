import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_SOURCES, roadmap, roadmapItems, shipped } from "./copilot-sources-product";

let root: string;
beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-product-"))));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("roadmapItems", () => {
  it("reads the first open items of docs/ROADMAP.md, without Done ones or bold marks", () => {
    fs.mkdirSync(path.join(root, "docs"));
    const items = Array.from({ length: 8 }, (_, i) => `${String(i + 1)}. **Item ${String(i + 1)}** — why`);
    fs.writeFileSync(path.join(root, "docs/ROADMAP.md"), ["# Roadmap", "- `Done` **Shipped**", ...items].join("\n"));
    expect(roadmapItems(root)).toEqual(["Item 1 — why", "Item 2 — why", "Item 3 — why", "Item 4 — why", "Item 5 — why", "Item 6 — why"]);
  });

  it("falls back to ROADMAP.md, and gives none without a roadmap", () => {
    expect(roadmapItems(root)).toEqual([]);
    fs.writeFileSync(path.join(root, "ROADMAP.md"), "* Saved views");
    expect(roadmapItems(root)).toEqual(["Saved views"]);
  });
});

describe("roadmap", () => {
  it("names each project with its items, and skips one without", async () => {
    fs.writeFileSync(path.join(root, "ROADMAP.md"), "- Saved views");
    expect(await roadmap([root, path.join(root, "none")], [])).toEqual([`- ${path.basename(root)}:`, "  Saved views"]);
  });
});

describe("shipped", () => {
  it("lists the week's feature and fix commits, and nothing for a folder that isn't a repo", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "feat: fold columns");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "docs(changelog): x");
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "weft-norepo-"));
    try {
      expect(await shipped([root, other], [])).toEqual([`- ${path.basename(root)}:`, "  feat: fold columns"]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("is listed with the roadmap as the product sources", () => {
    expect(PRODUCT_SOURCES.map((s) => s.source)).toEqual([roadmap, shipped]);
  });
});
