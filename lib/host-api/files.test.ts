// The editor's verbs (lib/host-api/files.ts) over a real folder: the index, a read, the HEAD text, a save that refuses
// a stale base, and the paths a save from another machine may not touch, symlinks and case folding included.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));
const data = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/weft-files-audit-${String(process.pid)}`);
vi.mock("@/lib/store", () => ({ DATA_DIR: data, getCard: vi.fn((id: string) => db.cards.get(id)) }));

const { AUDIT_LOG, listFilesVerb, readFileVerb, writeFileVerb } = await import("./files");
const { NotFound } = await import("./types");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-files-verb-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  db.cards.set("c1", { id: "c1", cwd: dir } as Card);
  fs.mkdirSync(data, { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  db.cards.clear();
});

describe("files.list and files.read", () => {
  it("lists the card's folder and reads one file", async () => {
    await expect(listFilesVerb({ id: "c1" })).resolves.toEqual({ files: ["src/a.ts"] });
    const { file } = (await readFileVerb({ id: "c1", path: "src/a.ts" })) as { file: { text: string; exists: boolean } };
    expect(file.text).toBe("export const a = 1;\n");
    expect(file.exists).toBe(true);
  });

  it("answers the HEAD text as null outside a repo", async () => {
    await expect(readFileVerb({ id: "c1", path: "src/a.ts", at: "HEAD" })).resolves.toEqual({ path: "src/a.ts", text: null });
  });

  it("refuses a card that isn't here, a read with no path, and one outside the folder", async () => {
    await expect(listFilesVerb({ id: "nope" })).rejects.toThrow(NotFound);
    await expect(readFileVerb({ id: "c1" } as never)).rejects.toThrow("A path is required.");
    await expect(readFileVerb({ id: "c1", path: "/etc/hosts" })).rejects.toThrow("outside the card's folder");
  });
});

describe("files.write", () => {
  it("saves over the base it read, and refuses a stale one with what's there now", async () => {
    const { file } = (await readFileVerb({ id: "c1", path: "src/a.ts" })) as { file: { hash: string } };
    const saved = await writeFileVerb({ id: "c1", path: "src/a.ts", text: "export const a = 2;\n", baseHash: file.hash });
    expect(saved).toHaveProperty("result.hash");
    expect(fs.readFileSync(path.join(dir, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");
    const stale = await writeFileVerb({ id: "c1", path: "src/a.ts", text: "x", baseHash: file.hash });
    expect(stale).toHaveProperty("conflict.text", "export const a = 2;\n");
  });

  it("refuses what configures an agent, and any .git, nested ones too", async () => {
    await expect(writeFileVerb({ id: "c1", path: ".Claude/commands/go.md", text: "x" })).rejects.toThrow();
    await expect(writeFileVerb({ id: "c1", path: ".VSCode/tasks.json", text: "{}" })).rejects.toThrow("doesn't save into .vscode");
    await expect(writeFileVerb({ id: "c1", path: "package.json", text: "{}" })).rejects.toThrow("doesn't save package.json");
    await expect(writeFileVerb({ id: "c1", path: "src/.git/hooks/pre-commit", text: "x" })).rejects.toThrow("inside .git");
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
  });

  it("refuses a symlink inside the folder that points a save at git's hooks", async () => {
    fs.mkdirSync(path.join(dir, ".githooks"));
    fs.symlinkSync(path.join(dir, ".githooks"), path.join(dir, "hooks"));
    await expect(writeFileVerb({ id: "c1", path: "hooks/pre-commit", text: "x" })).rejects.toThrow("doesn't save into .githooks");
    expect(fs.existsSync(path.join(dir, ".githooks", "pre-commit"))).toBe(false);
  });

  it("refuses a save with no text", async () => {
    await expect(writeFileVerb({ id: "c1", path: "src/b.ts" } as never)).rejects.toThrow("The file's text is required.");
  });
});

describe("credentials and the audit log", () => {
  it("never reads a credential in the folder, and leaves it out of the index", async () => {
    fs.mkdirSync(path.join(dir, ".ssh"));
    fs.writeFileSync(path.join(dir, ".ssh", "config"), "Host x");
    fs.writeFileSync(path.join(dir, "deploy.pem"), "key");
    await expect(readFileVerb({ id: "c1", path: ".ssh/config" })).rejects.toThrow("holds credentials");
    await expect(readFileVerb({ id: "c1", path: "deploy.pem", at: "HEAD" })).rejects.toThrow("holds credentials");
    const { files } = await listFilesVerb({ id: "c1" });
    expect(files).toEqual(["src/a.ts"]);
  });

  it("logs each remote read and save with its card and path", async () => {
    await readFileVerb({ id: "c1", path: "src/a.ts" });
    await writeFileVerb({ id: "c1", path: "src/new.ts", text: "x" });
    const lines = fs.readFileSync(path.join(data, AUDIT_LOG), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, string>);
    expect(lines.map((l) => [l.verb, l.card, l.path])).toEqual([
      ["files.read", "c1", "src/a.ts"],
      ["files.write", "c1", "src/new.ts"],
    ]);
  });

  it("keeps working when the log can't be written", async () => {
    fs.rmSync(data, { recursive: true, force: true });
    await expect(listFilesVerb({ id: "c1" })).resolves.toEqual({ files: ["src/a.ts"] });
  });
});
