import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";

// electron/vault.cjs with env files outside the project (electron/env-sources.cjs): a copy beside it, and a file
// you located with Locate….

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const LONG = "sk_test_aaaaaaaaaaaa1111"; // gitleaks:allow
const AWAY = "../app-build/.env.local";

function make(pickFile?: () => Promise<string | null>, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"))) {
  const run = vi.fn((_folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? "git@github.com:Owner/Repo.git" : ""));
  const vault = createVault({ dataDir, safeStorage, sodium, prompt: vi.fn(), clipboard: { writeText: vi.fn(), readText: () => "" }, run, pickFile });
  return { vault, run, dataDir };
}

function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

type Row = { file: string; name: string };

describe("createVault with env files elsewhere", () => {
  it("finds a copy's .env beside the project: previewed, nudged for what the vault lacks, and imported from there", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-near-")));
    const folder = path.join(root, "app");
    write(root, { "app/.env.local": "OWN=1\nBOTH=own\n", "app-build/.env.local": `KEY=${LONG}\nBOTH=build\nOWN=1\n`, "app-build/.env.example": "NOT_OURS=\n" });
    const { vault, run } = make();
    const scan = await vault.scan(folder);
    expect(scan.files.map((f: { file: string; elsewhere?: boolean }) => `${f.elsewhere ? "+" : ""}${f.file}`)).toEqual([".env.local", `+${AWAY}`]);
    expect(run).toHaveBeenCalledWith(folder, ["ls-files", "--", ".env.local"]);
    const at = (name: string) => scan.rows.find((r: Row) => r.file === AWAY && r.name === name);
    expect(at("KEY")).toMatchObject({ status: "new", ticked: true, tail: "1111" });
    // The project's own value wins: the copy's is offered but not ticked.
    expect(at("BOTH")).toMatchObject({ status: "new", ticked: false });

    await vault.importPicks(folder, [{ file: ".env.local", name: "BOTH" }]);
    // Only what the vault lacks nudges from elsewhere; the project's own file still nudges as before.
    expect((await vault.overview([folder])).vaults[0]!.nudge).toEqual({ count: 2, file: ".env.local", managed: false });
    await vault.importPicks(folder, [{ file: ".env.local", name: "OWN" }]);
    expect((await vault.overview([folder])).vaults[0]!.nudge).toEqual({ count: 1, file: AWAY, managed: false });
    expect(await vault.importPicks(folder, [{ file: AWAY, name: "KEY" }])).toEqual({ imported: 1 });
    expect((await vault.overview([folder])).vaults[0]!.nudge).toBeNull();
    const again = await vault.scan(folder);
    expect(again.rows.find((r: Row) => r.file === AWAY && r.name === "BOTH")).toMatchObject({ status: "differs", ticked: false });
  });

  it("locates an env file anywhere through main's dialog and reads it from then on", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "weft-keys-"));
    write(elsewhere, { "prod.env": "FOUND=yes\n" });
    const { vault, dataDir } = make(() => Promise.resolve(path.join(elsewhere, "prod.env")));
    const file = path.relative(folder, path.join(elsewhere, "prod.env"));
    expect(await vault.locate(folder)).toEqual({ file });
    expect((await vault.scan(folder)).rows).toMatchObject([{ file, name: "FOUND", status: "new", ticked: true }]);
    expect((await vault.overview([folder])).vaults[0]!.nudge).toMatchObject({ count: 1, file });
    // With no dialog to open (a test, an old shell) nothing is located; the remembered file stays.
    const fresh = make(undefined, dataDir).vault;
    expect(await fresh.locate(folder)).toBeNull();
    expect((await fresh.scan(folder)).rows).toHaveLength(1);
  });
});
