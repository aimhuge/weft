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
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, setTimer: (() => 0) as unknown as typeof setTimeout });
  return { vault, prompt };
}

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
});

describe("sendValues", () => {
  it("sends several values to code in main after ONE Touch ID, and none when a name is missing or the user says no", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt } = make();
    await vault.setValue(folder, "A", "development", "a-value");
    await vault.setValue(folder, "B", "development", "b-value");
    prompt.mockClear();
    const send = vi.fn((values: Record<string, string>) => Promise.resolve({ sealed: Object.keys(values) }));
    const reason = (label: string) => `seal A and B (${label})`;
    expect(await vault.sendValues(folder, ["A", "B"], "development", reason, send)).toEqual({ sealed: ["A", "B"], label: "Owner/Repo" });
    expect(send).toHaveBeenCalledWith({ A: "a-value", B: "b-value" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith("seal A and B (Owner/Repo)");

    send.mockClear();
    prompt.mockClear();
    expect(await vault.sendValues(folder, ["A", "NOPE"], "development", reason, send)).toEqual({ missing: ["NOPE"], label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockResolvedValue(false);
    expect(await vault.sendValues(folder, ["A", "B"], "development", reason, send)).toEqual({ denied: true, label: "Owner/Repo" });
    expect(send).not.toHaveBeenCalled();
  });
});
