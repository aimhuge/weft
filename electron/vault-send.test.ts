import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";

// vault.sendValue: one value handed to code in main (a push to Vercel), behind its own Touch ID every time.

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const LONG = "sk_test_aaaaaaaaaaaa1111"; // gitleaks:allow

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  return root;
}

function make() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const prompt = vi.fn(() => Promise.resolve(true));
  let clip = "";
  const clipboard = { writeText: vi.fn((t: string) => (clip = t)), readText: () => clip };
  const run = vi.fn((_folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? "git@github.com:Owner/Repo.git" : ""));
  const audit = vi.fn();
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, audit, setTimer: (() => 0) as unknown as typeof setTimeout });
  return { vault, prompt, audit };
}

// The audit lines a vault wrote, newest last.
const lines = (audit: ReturnType<typeof vi.fn>) => audit.mock.calls.map((c) => c[0] as Record<string, unknown>);

describe("sendValue", () => {
  it("sends a value to code in main after a Touch ID every time, even while the drawer is unlocked", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt } = make();
    await vault.setValue(folder, "KEY", "production", LONG);
    await vault.reveal("github:owner/repo", "KEY", "production");
    prompt.mockClear();
    const send = vi.fn((value: string) => Promise.resolve({ pushed: value.length }));
    const reason = (label: string) => `push KEY (${label}) to Vercel`;
    expect(await vault.sendValue(folder, "KEY", "production", reason, send)).toEqual({ pushed: LONG.length, label: "Owner/Repo" });
    expect(send).toHaveBeenCalledWith(LONG);
    expect(prompt).toHaveBeenCalledWith("push KEY (Owner/Repo) to Vercel");
    await vault.sendValue(folder, "KEY", "production", reason, send);
    expect(prompt).toHaveBeenCalledTimes(2);

    expect(await vault.sendValue(folder, "NOPE", "production", reason, send)).toEqual({ missing: true, label: "Owner/Repo" });
    prompt.mockResolvedValue(false);
    send.mockClear();
    expect(await vault.sendValue(folder, "KEY", "production", reason, send)).toEqual({ denied: true, label: "Owner/Repo" });
    expect(send).not.toHaveBeenCalled();
  });

  // A card whose grant names writes pushes without another Touch ID: the user approved its
  // writes up front (electron/vault-grants.cjs, 2026-10-29).
  it("sends without asking when the card's grant names writes, and says it came from the grant", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt, audit } = make();
    await vault.setValue(folder, "KEY", "production", LONG);
    await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
    prompt.mockClear();
    const send = vi.fn((value: string) => Promise.resolve({ pushed: value.length }));
    const reason = (label: string) => `push KEY (${label}) to Vercel`;

    expect(await vault.sendValue(folder, "KEY", "production", reason, send, "c1")).toEqual({ pushed: LONG.length, label: "Owner/Repo" });
    expect(send).toHaveBeenCalledWith(LONG);
    expect(prompt).not.toHaveBeenCalled();
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "send", by: "weft", card: "c1", via: "grant", outcome: "ok" }));
  });

  it("still asks when the card's grant names no writes", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt } = make();
    await vault.setValue(folder, "KEY", "production", LONG);
    await vault.grant(folder, { card: "c1", thread: "Build card", by: "you" });
    prompt.mockClear();
    const send = vi.fn((value: string) => Promise.resolve({ pushed: value.length }));
    const reason = (label: string) => `push KEY (${label}) to Vercel`;

    expect(await vault.sendValue(folder, "KEY", "production", reason, send, "c1")).toEqual({ pushed: LONG.length, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledWith("push KEY (Owner/Repo) to Vercel");
  });

  it("still asks when another card's grant names writes", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt } = make();
    await vault.setValue(folder, "KEY", "production", LONG);
    await vault.grant(folder, { card: "c2", thread: "Other card", by: "you", writes: true });
    prompt.mockClear();
    const send = vi.fn((value: string) => Promise.resolve({ pushed: value.length }));
    const reason = (label: string) => `push KEY (${label}) to Vercel`;

    expect(await vault.sendValue(folder, "KEY", "production", reason, send, "c1")).toEqual({ pushed: LONG.length, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledWith("push KEY (Owner/Repo) to Vercel");
  });
});
