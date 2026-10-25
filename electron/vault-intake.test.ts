import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanBlanks, intakeVault as untyped } from "./vault-intake.cjs";

// electron/vault-intake.cjs: the 🔐 side of the project intake, against a fake vault. Only the .env file's
// presence is real (findEnvFiles reads the folder); what the vault's scan says about it is the fake's.

type Row = { file: string; name: string; environment: string; status: string; ticked: boolean };
type File = { file: string; tracked?: boolean; namesOnly?: boolean };

function folder(withEnv: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-intake-"));
  if (withEnv) fs.writeFileSync(path.join(dir, ".env.local"), "");
  return dir;
}

function fakeVault({ files = [], rows = [], names = [] }: { files?: File[]; rows?: Row[]; names?: string[] } = {}) {
  return {
    scan: vi.fn(() => Promise.resolve({ files, rows })),
    importPicks: vi.fn(() => Promise.resolve()),
    names: vi.fn(() => Promise.resolve({ secrets: names.map((name) => ({ name })) })),
    addBlanks: vi.fn(() => Promise.resolve()),
    notify: vi.fn(),
  };
}

// The .cjs defaults its options to [], which TypeScript reads as never[].
type Blank = { name: string; source: string; hint?: string };
const intakeVault = untyped as (vault: unknown, folder: string, opts?: { blanks?: Blank[]; skip?: string[] }) => ReturnType<typeof untyped>;

const row = (name: string, status = "new", over: Partial<Row> = {}): Row => ({ file: ".env.local", name, environment: "development", status, ticked: true, ...over });

describe("intakeVault", () => {
  it("does nothing in a folder with no .env file and no blanks", async () => {
    const vault = fakeVault();
    expect(await intakeVault(vault, folder(false))).toEqual({ imported: [], blanked: [], tracked: [], keys: [] });
    expect(vault.scan).not.toHaveBeenCalled();
  });

  it("imports the ticked new rows, never a differing or unticked one, and tells the board", async () => {
    const vault = fakeVault({
      files: [{ file: ".env.local" }],
      rows: [row("A_KEY"), row("B_KEY", "differs"), row("C_KEY", "new", { ticked: false }), row("D_KEY", "same")],
    });
    const result = await intakeVault(vault, folder(true));
    expect(vault.importPicks).toHaveBeenCalledWith(expect.any(String), [{ file: ".env.local", name: "A_KEY" }]);
    expect(result.imported).toEqual([{ file: ".env.local", name: "A_KEY", environment: "development" }]);
    expect(result.keys).toEqual(["env\n.env.local\nA_KEY\ndevelopment"]);
    expect(vault.notify).toHaveBeenCalledTimes(1);
  });

  it("never imports from a file git tracks, and says which file to rotate", async () => {
    const vault = fakeVault({ files: [{ file: ".env.local", tracked: true }], rows: [row("A_KEY"), row("B_KEY")] });
    const result = await intakeVault(vault, folder(true));
    expect(vault.importPicks).not.toHaveBeenCalled();
    expect(result).toMatchObject({ imported: [], tracked: [".env.local"], keys: [] });
    expect(vault.notify).not.toHaveBeenCalled();
  });

  it("imports from a tracked .env.example's names-only file as usual", async () => {
    const vault = fakeVault({ files: [{ file: ".env.example", tracked: true, namesOnly: true }], rows: [row("A_KEY", "new", { file: ".env.example" })] });
    const result = await intakeVault(vault, folder(true));
    expect(result.imported).toEqual([{ file: ".env.example", name: "A_KEY", environment: "development" }]);
    expect(result.tracked).toEqual([]);
  });

  it("skips what an earlier intake offered", async () => {
    const vault = fakeVault({ files: [{ file: ".env.local" }], rows: [row("A_KEY")] });
    const result = await intakeVault(vault, folder(true), {
      blanks: [{ name: "B_KEY", source: "your code" }],
      skip: ["env\n.env.local\nA_KEY\ndevelopment", "blank\nB_KEY"],
    });
    expect(vault.importPicks).not.toHaveBeenCalled();
    expect(vault.addBlanks).not.toHaveBeenCalled();
    expect(result.keys).toEqual([]);
  });

  it("adds blanks grouped by source and hint, once a name, never for a name the vault or a file holds", async () => {
    const vault = fakeVault({ files: [{ file: ".env.local" }], rows: [row("IN_FILE", "same"), row("MISSING", "missing")], names: ["IN_VAULT"] });
    const result = await intakeVault(vault, folder(true), {
      blanks: [
        { name: "STRIPE_KEY", source: "your code", hint: "Stripe" },
        { name: "STRIPE_SECRET", source: "your code", hint: "Stripe" },
        { name: "STRIPE_KEY", source: "your code", hint: "Stripe" },
        { name: "OTHER_TOKEN", source: ".env.example" },
        { name: "IN_VAULT", source: "your code" },
        { name: "IN_FILE", source: "your code" },
        { name: "MISSING", source: "your code" },
      ],
    });
    expect(vault.addBlanks.mock.calls).toEqual([
      [expect.any(String), ["STRIPE_KEY", "STRIPE_SECRET"], ["development"], { source: "your code", hint: "Stripe" }],
      [expect.any(String), ["OTHER_TOKEN"], ["development"], { source: ".env.example", hint: undefined }],
      [expect.any(String), ["MISSING"], ["development"], { source: "your code", hint: undefined }],
    ]);
    expect(result.blanked).toEqual(["STRIPE_KEY", "STRIPE_SECRET", "OTHER_TOKEN", "MISSING"]);
    expect(result.keys).toContain("blank\nMISSING");
  });

  it("adds blanks in a folder with no .env file, without scanning it", async () => {
    const vault = fakeVault();
    const result = await intakeVault(vault, folder(false), { blanks: [{ name: "A_KEY", source: "your code" }] });
    expect(vault.scan).not.toHaveBeenCalled();
    expect(result.blanked).toEqual(["A_KEY"]);
    expect(vault.notify).not.toHaveBeenCalled();
  });
});

describe("cleanBlanks", () => {
  it("keeps valid names, cuts hints and sources to size and caps the list", () => {
    const blanks = cleanBlanks([
      { name: "GOOD_KEY", hint: "h".repeat(500), source: "s".repeat(80) },
      { name: "bad name" },
      null,
      { name: 7 },
      { name: "NO_SOURCE", hint: 3 },
    ]);
    expect(blanks).toEqual([
      { name: "GOOD_KEY", hint: "h".repeat(400), source: "s".repeat(60) },
      { name: "NO_SOURCE", hint: undefined, source: "the intake" },
    ]);
    expect(cleanBlanks("x")).toEqual([]);
    expect(cleanBlanks(Array.from({ length: 30 }, (_, i) => ({ name: `K${i}` })))).toHaveLength(25);
  });
});
