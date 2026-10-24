// What electron/goose-token.cjs owes the Goose runner: the keys stay encrypted on disk, the file stays 0600, and a
// provider's key round-trips. The 0600 mode in particular is what nothing downstream would notice if it went wrong.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forgetGooseProvider, gooseTokenFile, listGooseProviders, readGooseProvider, readGooseTokens, writeGooseProvider } from "./goose-token.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  // Marked so a raw read of the file is obvious in a failure: the key must never sit there in plain.
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-"));
  dirs.push(dir);
  return path.join(dir, "goose-tokens.json");
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("writeGooseProvider", () => {
  it("keeps the key out of the file in plain, and round-trips it", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "openrouter", "sk-or-abc123");
    expect(fs.readFileSync(file, "utf8")).not.toContain("sk-or-abc123");
    expect(readGooseProvider(safeStorage, file, "openrouter")?.token).toBe("sk-or-abc123");
  });

  it("writes it 0600, so no other account on the Mac can read it", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "openrouter", "sk-or-abc123");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is 0600 on every write, not just the first", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "openrouter", "first");
    fs.chmodSync(file, 0o644); // a stray chmod, or a umask shift on a rewrite
    writeGooseProvider(safeStorage, file, "openrouter", "second");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("creates the data directory when it's the first file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "goose-tokens.json");
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    writeGooseProvider(safeStorage, file, "anthropic", "sk-ant-abc");
    expect(readGooseProvider(safeStorage, file, "anthropic")?.token).toBe("sk-ant-abc");
  });

  it("stamps savedAt, and keeps the non-secret metadata beside the key", () => {
    const file = tmp();
    const saved = writeGooseProvider(safeStorage, file, "custom", "sk-custom", { baseUrl: "https://api.example.com/v1", model: "my-model" });
    expect(saved.token).toBe(Buffer.from("w:sk-custom").toString("base64"));
    expect(saved.baseUrl).toBe("https://api.example.com/v1");
    expect(saved.model).toBe("my-model");
    expect(typeof saved.savedAt).toBe("string");
  });

  it("holds one key per provider, so several providers can be set up", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "openrouter", "sk-or-abc");
    writeGooseProvider(safeStorage, file, "anthropic", "sk-ant-abc");
    const all = readGooseTokens(safeStorage, file);
    expect(all.openrouter).toBeDefined();
    expect(all.anthropic).toBeDefined();
    expect(all.openrouter!.token).toBe("sk-or-abc");
    expect(all.anthropic!.token).toBe("sk-ant-abc");
  });

  it("refuses before anything is written when the Keychain isn't available", () => {
    const file = tmp();
    const locked = { ...safeStorage, isEncryptionAvailable: () => false };
    expect(() => writeGooseProvider(locked, file, "openrouter", "sk-or-abc")).toThrow(/Keychain isn't available/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("names the credential, since that's the only sentence the user sees", () => {
    const file = tmp();
    const locked = { ...safeStorage, isEncryptionAvailable: () => false };
    expect(() => writeGooseProvider(locked, file, "openrouter", "sk-or-abc")).toThrow(/keep the Goose provider key safely/);
  });

  it("refuses an empty key", () => {
    const file = tmp();
    expect(() => writeGooseProvider(safeStorage, file, "openrouter", "   ")).toThrow(/Paste the provider's API key/);
    expect(() => writeGooseProvider(safeStorage, file, "", "sk-or-abc")).toThrow(/Which provider is this key for/);
  });
});

describe("readGooseTokens", () => {
  it("is empty before anything is saved", () => {
    expect(readGooseTokens(safeStorage, tmp())).toEqual({});
    expect(readGooseProvider(safeStorage, tmp(), "openrouter")).toBeNull();
  });

  it("throws on a file it can't read, rather than signing the user out silently", () => {
    const file = tmp();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ truncated");
    expect(() => readGooseTokens(safeStorage, file)).toThrow();
  });
});

describe("forgetGooseProvider", () => {
  it("removes the key, and leaves the others alone", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "openrouter", "sk-or-abc");
    writeGooseProvider(safeStorage, file, "anthropic", "sk-ant-abc");
    expect(forgetGooseProvider(safeStorage, file, "openrouter")).toEqual({ removed: true });
    expect(readGooseProvider(safeStorage, file, "openrouter")).toBeNull();
    expect(readGooseProvider(safeStorage, file, "anthropic")?.token).toBe("sk-ant-abc");
  });

  it("says so when there was nothing to remove", () => {
    expect(forgetGooseProvider(safeStorage, tmp(), "openrouter")).toEqual({ removed: false });
  });
});

describe("listGooseProviders", () => {
  it("never returns a key, only the metadata beside it", () => {
    const file = tmp();
    writeGooseProvider(safeStorage, file, "custom", "sk-custom", { baseUrl: "https://api.example.com/v1", model: "my-model" });
    const list = listGooseProviders(safeStorage, file);
    expect(list.custom).toBeDefined();
    expect(list.custom!.baseUrl).toBe("https://api.example.com/v1");
    expect(list.custom!.model).toBe("my-model");
    expect(JSON.stringify(list)).not.toContain("sk-custom");
  });

  it("is empty before anything is saved", () => {
    expect(listGooseProviders(safeStorage, tmp())).toEqual({});
  });
});

describe("gooseTokenFile", () => {
  it("is the store's file in the data folder", () => {
    expect(gooseTokenFile("/tmp/weft")).toBe(path.join("/tmp/weft", "goose-tokens.json"));
  });
});
