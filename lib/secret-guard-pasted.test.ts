import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types-thread";

// The attachments folder opens one file at a time, to the card whose user pasted it (2026-10-31): a thread
// couldn't Read the screenshot its user had just pasted into it.

const h = vi.hoisted(() => {
  const threads: Record<string, ThreadItem[]> = {};
  return { threads };
});
vi.mock("./store", () => ({ DATA_DIR: "/nonexistent/.weft", getThread: (id: string) => h.threads[id] ?? [] }));

const { pastedInto } = await import("./secret-guard-pasted");
const { toolVerdict } = await import("./secret-guard-tool");
const { secretGuardMatcher, SECRET_GUARD_MATCHER } = await import("./secret-guard");

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-pasted-")));
const attachments = path.join(data, "attachments");
fs.mkdirSync(attachments);
const shot = path.join(attachments, "pasted-image-ba4d04ab.webp");
fs.writeFileSync(shot, "img");
const other = path.join(attachments, "screen-shot-11111111.png");
fs.writeFileSync(other, "img");
fs.mkdirSync(path.join(data, "vault"));
fs.writeFileSync(path.join(data, "vault", "acme.json"), "{}");

const user = (text: string): ThreadItem => ({ kind: "user", text, at: 1 });
const threads = h.threads;
threads.c1 = [user(`look at this ![pasted image](${shot})`), { kind: "assistant", text: `![other](${other})`, at: 2 }];
threads.c2 = [user(`mine ![x](${other}) and ![web](https://example.com/pasted-image-ba4d04ab.webp)`)];
threads.c3 = [{ kind: "edited", at: 3, items: [user("![old](</Users/me/.weft/attachments/pasted-image-ba4d04ab.webp>)")] }];
const thread = (id: string) => threads[id] ?? [];

describe("pastedInto", () => {
  it("opens an attachment the user pasted into this card", () => {
    expect(pastedInto("c1", shot, data, thread)).toBe(true);
  });

  it("keeps another card's attachment, and one only the assistant named, sealed", () => {
    expect(pastedInto("c1", other, data, thread)).toBe(false);
    expect(pastedInto("c2", shot, data, thread)).toBe(false);
  });

  it("opens nothing for a cardless guard, an empty path, or the folder itself", () => {
    expect(pastedInto(undefined, shot, data, thread)).toBe(false);
    expect(pastedInto("c1", "", data, thread)).toBe(false);
    expect(pastedInto("c1", attachments, data, thread)).toBe(false);
  });

  it("reads a desktop's ~/.weft path on a Worker, and a message folded into an edit", () => {
    expect(pastedInto("c3", "/Users/me/.weft/attachments/pasted-image-ba4d04ab.webp", data, thread)).toBe(true);
    expect(pastedInto("c3", "'/Users/me/.weft/attachments/pasted-image-ba4d04ab.webp'", data, thread)).toBe(true);
  });

  it("won't open a file outside an attachments folder under a pasted name", () => {
    expect(pastedInto("c1", path.join(data, "vault", "pasted-image-ba4d04ab.webp"), data, thread)).toBe(false);
    expect(pastedInto("c1", path.join(attachments, "..", "vault", "acme.json"), data, thread)).toBe(false);
  });

  it("won't follow a pasted name that is a link into the vault", () => {
    const link = path.join(attachments, "pasted-link-22222222.png");
    fs.symlinkSync(path.join(data, "vault", "acme.json"), link);
    threads.c4 = [user(`![x](${link})`)];
    expect(pastedInto("c4", link, data, thread)).toBe(false);
  });
});

describe("a board thread's secret guard", () => {
  const pasted = "/Users/me/.weft/attachments/pasted-image-ba4d04ab.webp";
  const pre = (file_path: string) =>
    ({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path }, tool_use_id: "t", session_id: "s", transcript_path: "/t", cwd: "/p" }) as never;
  const run = (cardId: string | undefined, file: string) => secretGuardMatcher(() => cardId).hooks[0]?.(pre(file), "t", { signal: new AbortController().signal });

  it("checks the same tools as the cardless guard", () => {
    expect(secretGuardMatcher(() => "c3").matcher).toBe(SECRET_GUARD_MATCHER.matcher);
  });

  it("lets its card Read what the user pasted, and nobody else", async () => {
    expect(await run("c3", pasted)).toEqual({});
    expect(JSON.stringify(await run("c2", pasted))).toContain("deny");
    expect(JSON.stringify(await run(undefined, pasted))).toContain("deny");
  });
});

describe("toolVerdict on an attachment", () => {
  it("lets a card Read what its user pasted, from the store's thread", () => {
    expect(toolVerdict("Read", { file_path: shot }, data, "c1")).toBeNull();
  });

  it("still refuses it to another card, a cardless guard, a write, a listing and the rest of the data dir", () => {
    expect(toolVerdict("Read", { file_path: shot }, data, "c2")).toContain("can't be read");
    expect(toolVerdict("Read", { file_path: shot }, data)).toContain("can't be read");
    expect(toolVerdict("Write", { file_path: shot }, data, "c1")).toContain("can't be read");
    expect(toolVerdict("LS", { path: attachments }, data, "c1")).toContain("can't be read");
    expect(toolVerdict("Read", { file_path: path.join(data, "vault", "acme.json") }, data, "c1")).toContain("can't be read");
  });
});

describe("Bash on a pasted file", () => {
  const bash = (command: string, card = "c1") => toolVerdict("Bash", { command }, data, card);

  it("lets a card cp or ffmpeg the file its user pasted", () => {
    expect(bash(`cp ${shot} ~/dev/app/renders/`)).toBeNull();
    expect(bash(`ffmpeg -i "${shot}" out.mp4 && ls`)).toBeNull();
  });

  it("keeps another card's paste, the folder, and the rest of the data dir sealed", () => {
    expect(bash(`cp ${other} /tmp/`)).not.toBeNull();
    expect(bash(`cp ${shot} /tmp/`, "c2")).not.toBeNull();
    expect(bash(`ls ${attachments}`)).not.toBeNull();
    expect(bash(`cp ${shot} ${path.join(data, "vault", "acme.json")} /tmp/`)).not.toBeNull();
  });
});
