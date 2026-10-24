import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { describeCode, inRepo, mapPile, parseNumstat, parseStatus, pilePrompt, readPile, repoCards, type Pile } from "./commit-pile";
import { SHOW_DIR } from "./show-dir";
import type { Card } from "./types";

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: "/dev/app", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over };
}

describe("parseStatus", () => {
  it("reads codes and paths, skipping a rename's original path", () => {
    const out = " M lib/a.ts\0?? new file.ts\0R  lib/b.ts\0lib/old-b.ts\0D  gone.ts\0";
    expect(parseStatus(out)).toEqual([
      { path: "lib/a.ts", code: " M" },
      { path: "new file.ts", code: "??" },
      { path: "lib/b.ts", code: "R " },
      { path: "gone.ts", code: "D " },
    ]);
  });

  it("skips a copy's original path too, and is empty for a clean tree", () => {
    expect(parseStatus("C  b.ts\0a.ts\0")).toEqual([{ path: "b.ts", code: "C " }]);
    expect(parseStatus("")).toEqual([]);
  });
});

describe("parseNumstat", () => {
  it("sums lines and counts binary files as nothing", () => {
    expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n10\t0\tb.ts\n")).toEqual({ added: 13, removed: 1 });
  });
});

describe("inRepo / repoCards", () => {
  it("matches the root and folders inside it, not look-alike siblings", () => {
    expect(inRepo("/dev/app", "/dev/app")).toBe(true);
    expect(inRepo("/dev/app/web", "/dev/app")).toBe(true);
    expect(inRepo("/dev/app/web", "/dev/app/")).toBe(true);
    expect(inRepo("/dev/apple", "/dev/app")).toBe(false);
  });

  it("keeps the repo's open cards only", () => {
    const cards = [
      card("a"),
      card("b", { archived: true }),
      card("c", { role: "copilot" }),
      card("d", { column: "done" }),
      card("e", { cwd: "/dev/other" }),
      card("f", { column: "running" }),
    ];
    expect(repoCards(cards, "/dev/app").map((c) => c.id)).toEqual(["a", "f"]);
  });
});

describe("mapPile", () => {
  const files = [
    { path: "a.ts", code: " M" },
    { path: "shared.ts", code: " M" },
    { path: "busy.ts", code: " M" },
    { path: "loose.ts", code: "??" },
  ];
  const a = card("a", { touchedFiles: ["/dev/app/a.ts", "/dev/app/shared.ts", "/elsewhere/x.ts"] });
  const b = card("b", { touchedFiles: ["/dev/app/shared.ts"] });
  const c = card("c", { touchedFiles: [] });
  const r = card("r", { column: "running", touchedFiles: ["/dev/app/busy.ts", "/dev/app/a.ts"] });

  it("gives each file to its one Review card, and flags shared, busy and unclaimed files", () => {
    const map = mapPile(files, [a, b, c, r, card("n")], "/dev/app");
    expect(map.cards.map((p) => [p.card.id, p.files.map((f) => f.path)])).toEqual([
      ["a", ["a.ts"]],
      ["b", []],
      ["c", []],
      ["n", []],
    ]);
    expect(map.shared).toEqual([{ file: files[1], cards: [a, b] }]);
    expect(map.busy).toEqual([{ file: files[2], cards: [r] }]);
    expect(map.unclaimed).toEqual([files[3]]);
  });
});

describe("describeCode", () => {
  it("names the staged letter, else the unstaged one", () => {
    expect(describeCode(" M")).toBe("modified");
    expect(describeCode("A ")).toBe("added");
    expect(describeCode("??")).toBe("new");
    expect(describeCode(" D")).toBe("deleted");
    expect(describeCode("UU")).toBe("changed");
  });
});

describe("pilePrompt", () => {
  const pile: Pile = { root: "/dev/app", files: [], added: 12, removed: 4 };
  const base = { pile, commitScript: "/weft/plugin/skills/done/commit.sh", origin: "http://localhost:3000" };

  it("lists each card's files and status, the flagged files, and the safety rules", () => {
    const a = card("a", {
      stage: "Polishing",
      remaining: "await your OK",
      thumb: "/api/attachments/shot.png",
      emoji: "🎛️",
      review: { steps: [{ title: "Header counter", look: "Hover it" }, { title: "Click it" }] },
    });
    const b = card("b", { column: "running" });
    const prompt = pilePrompt({
      ...base,
      map: {
        cards: [{ card: a, files: [{ path: "a.ts", code: " M" }] }, { card: card("e"), files: [] }],
        shared: [{ file: { path: "s.ts", code: " M" }, cards: [a, card("c")] }],
        busy: [{ file: { path: "busy.ts", code: " M" }, cards: [b] }],
        unclaimed: [{ path: "loose.ts", code: "??" }],
      },
    });
    expect(prompt).toContain("committing the uncommitted work in /dev/app: 0 files, +12/-4 lines");
    expect(prompt).toContain("never `git stash`, `git reset`");
    expect(prompt).toContain('bash /weft/plugin/skills/done/commit.sh "<type(scope): message>"');
    expect(prompt).toContain('1. "Card a" (card a): stage Polishing; remaining: await your OK\n');
    expect(prompt).toContain('nothing uncommitted (maybe already committed): "Card e" (e, review).');
    expect(prompt).toContain('- s.ts (modified): "Card a" (a, review), "Card c" (c, review)');
    expect(prompt).toContain('- busy.ts (modified): "Card b" (b, running)');
    expect(prompt).toContain("- loose.ts (new)");
    expect(prompt).toContain(`${SHOW_DIR}/commit-app/index.html`);
    expect(prompt).toContain("   picture: http://localhost:3000/api/attachments/shot.png\n   emoji: 🎛️\n   try: Header counter: Hover it\n   try: Click it\n   - a.ts (modified)");
    expect(prompt).toContain("for someone who doesn't read code");
    expect(prompt).toContain("Technical details");
    expect(prompt).toContain("weft://reply?text=<url-encoded message>");
    expect(prompt).toContain("curl -s -X PATCH http://localhost:3000/api/cards/<card id>");
  });

  it("speaks in commit, push and /done, never save", () => {
    const prompt = pilePrompt({ ...base, map: { cards: [], shared: [], busy: [], unclaimed: [] } });
    expect(prompt).toContain('"2 of 7 committed"');
    expect(prompt).toContain('"Commit", "Commit and push" and "Commit and run /done" run with no turn');
    expect(prompt).toContain('A "Committed" stamp');
    expect(prompt).toContain("skip it for now.");
    expect(prompt).toContain("run `git push` if I asked");
    expect(prompt).toContain("5. When every change that can go is committed");
    expect(prompt).toContain("`bash /weft/plugin/skills/done/push.sh`, then `node /weft/plugin/skills/done/deploy.mjs` in the background");
    expect(prompt).toContain("6. Finish with what is still uncommitted and why.");
  });

  it("puts the paths and message on each commit button, and has the page listen for the result", () => {
    const prompt = pilePrompt({ ...base, map: { cards: [], shared: [], busy: [], unclaimed: [] } });
    expect(prompt).toContain("weft://commit?change=<n>&label=<url-encoded title>&message=<url-encoded commit message>&path=<file>&path=<file>");
    expect(prompt).toContain("`&push=1`");
    expect(prompt).toContain("`&done=<that card's id>`");
    expect(prompt).toContain("`weft-commit` event on window: `detail` is `{ change, ok, hash, pushed, done, failed, error }`");
    expect(prompt).toContain("don't commit it yourself unless I ask");
    expect(prompt).not.toMatch(/\bsav(e|ed)\b/i);
  });

  it("says when no Review card claims anything and leaves out empty groups", () => {
    const prompt = pilePrompt({ ...base, map: { cards: [{ card: card("a", { thumb: "https://x/y.png" }), files: [{ path: "a.ts", code: " M" }] }], shared: [], busy: [], unclaimed: [] } });
    expect(prompt).toContain("   picture: https://x/y.png\n");
    expect(prompt).toContain('"Card a" (card a): no status line yet');
    const none = pilePrompt({ ...base, map: { cards: [], shared: [], busy: [], unclaimed: [] } });
    expect(none).toContain("No card in Review claims any of the uncommitted files.");
    expect(none).not.toContain("Shared:");
    expect(none).not.toContain("maybe already committed");
  });
});

describe("readPile", () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-pile-")));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", tmp, ...args], { stdio: "ignore" });

  it("is null outside a git repo", () => {
    expect(readPile(tmp)).toBeNull();
  });

  it("lists files with no line counts before the first commit", () => {
    git("init", "-q");
    fs.writeFileSync(path.join(tmp, "a.txt"), "one\n");
    expect(readPile(tmp)).toEqual({ root: tmp, files: [{ path: "a.txt", code: "??" }], added: 0, removed: 0 });
  });

  it("is null for a clean tree, and counts lines from a subfolder", () => {
    git("add", "a.txt");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    expect(readPile(tmp)).toBeNull();
    fs.mkdirSync(path.join(tmp, "sub"));
    fs.writeFileSync(path.join(tmp, "a.txt"), "two\nthree\n");
    fs.writeFileSync(path.join(tmp, "sub", "b.txt"), "b\n");
    expect(readPile(path.join(tmp, "sub"))).toEqual({
      root: tmp,
      files: [
        { path: "a.txt", code: " M" },
        { path: "sub/b.txt", code: "??" },
      ],
      added: 2,
      removed: 1,
    });
  });
});
