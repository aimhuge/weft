import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localVaultRepos } from "./vault-local-repos.cjs";

const dirWith = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-local-repos-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
};
const vault = (id: string, secrets: unknown[]) => JSON.stringify({ id, secrets });

describe("localVaultRepos", () => {
  it("lists GitHub vaults holding a value and not shared, sorted", () => {
    const dir = dirWith({
      "000000000000000b.json": vault("github:aimhuge/weft", [{ name: "A", ciphertext: "x" }]),
      "000000000000000a.json": vault("github:aimhuge/components", [{ name: "B", ciphertext: "y" }]),
      "000000000000000c.json": vault("github:aimhuge/blank", [{ name: "C" }]),
      "000000000000000d.json": vault("github:aimhuge/team", [{ name: "D", ciphertext: "z" }]),
      "000000000000000d.shared.json": "{}",
      "000000000000000e.json": vault("folder:/tmp/x", [{ name: "E", ciphertext: "z" }]),
      "000000000000000f.json": "{torn",
      "0000000000000010.json": JSON.stringify({ id: 7, secrets: [] }),
      "0000000000000011.json": JSON.stringify({ id: "github:a/no-list", secrets: "x" }),
      "notes.txt": "hi",
    });
    expect(localVaultRepos(dir)).toEqual(["aimhuge/components", "aimhuge/weft"]);
  });

  it("is empty with no vault folder", () => {
    expect(localVaultRepos(path.join(os.tmpdir(), "weft-no-such-dir-xyz"))).toEqual([]);
  });

  it("never returns a value or a key", () => {
    const dir = dirWith({ "0000000000000001.json": vault("github:a/b", [{ name: "SECRET", ciphertext: "CIPHER" }]) });
    expect(JSON.stringify(localVaultRepos(dir))).not.toMatch(/CIPHER|SECRET/);
  });
});
