import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";
import { vaultRoutes } from "./vault-routes.cjs";

// mcp__secrets__set_values' route: several writes, one Touch ID (fillMany in electron/vault-routes.cjs).
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};
const SECRET = "generated-0123456789abcdef";

function make() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  const prompt = vi.fn((reason: string) => Promise.resolve(Boolean(reason)));
  const run = () => Promise.resolve("git@github.com:Owner/Repo.git");
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard: { writeText: vi.fn(), readText: () => "" }, run });
  const routes = vaultRoutes(() => vault) as unknown as Record<string, (body: Record<string, unknown>) => Promise<unknown>>;
  const many = (secrets: unknown) => routes["POST /secrets/set-many"]!({ folder, secrets });
  const values = async (names: string[], env = "development") => (await vault.valuesFor(folder, names, env)).values;
  return { vault, folder, prompt, many, values, dataDir };
}

describe("POST /secrets/set-many", () => {
  it("adds, fills and overwrites with ONE Touch ID that names each secret, its environment and the overwrites", async () => {
    const { vault, folder, prompt, many, values, dataDir } = make();
    await vault.addBlanks(folder, ["BLANK"], ["development"], {});
    await vault.setValue(folder, "PRICE", "production", "price_live");
    await vault.setValue(folder, "KEEP", "development", "keep_me");
    prompt.mockClear();

    const r = await many([
      { name: "NEW", value: SECRET },
      { name: "NEW", value: `${SECRET}-prod`, environment: "production" },
      { name: "BLANK", value: "blank-value" },
      { name: "PRICE", value: "price_sandbox", environment: "production", replace: true },
      { name: "KEEP", value: "not-this" },
    ]);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(
      "let a thread store 4 secrets in Owner/Repo: add NEW (development), NEW (production); set BLANK (development); overwrite PRICE (production) with new values",
    );
    expect(r).toEqual({
      ok: true,
      label: "Owner/Repo",
      added: [{ name: "NEW", environment: "development" }, { name: "NEW", environment: "production" }],
      set: [{ name: "BLANK", environment: "development" }],
      replaced: [{ name: "PRICE", environment: "production" }],
      filled: [{ name: "KEEP", environment: "development" }],
    });
    // No value in the prompt or the answer.
    const said = JSON.stringify([r, prompt.mock.calls]);
    for (const v of [SECRET, "blank-value", "price_sandbox", "price_live", "not-this"]) expect(said).not.toContain(v);
    expect(await values(["NEW", "BLANK", "KEEP"])).toEqual({ NEW: SECRET, BLANK: "blank-value", KEEP: "keep_me" });
    expect(await values(["NEW", "PRICE"], "production")).toEqual({ NEW: `${SECRET}-prod`, PRICE: "price_sandbox" });
    for (const f of fs.readdirSync(path.join(dataDir, "vault"))) expect(fs.readFileSync(path.join(dataDir, "vault", f), "utf8")).not.toContain(SECRET);
  });

  it("writes nothing when the user says no", async () => {
    const { prompt, many, values } = make();
    prompt.mockResolvedValueOnce(false);
    expect(await many([{ name: "A", value: "a" }, { name: "B", value: "b" }])).toEqual({ denied: true, label: "Owner/Repo", filled: [] });
    expect(await values(["A", "B"])).toEqual({});
  });

  it("asks nothing when every name already has a value and none says replace (a string true isn't replace)", async () => {
    const { vault, folder, prompt, many } = make();
    await vault.setValue(folder, "A", "development", "a");
    prompt.mockClear();
    expect(await many([{ name: "A", value: "x", replace: "true" }])).toEqual({ label: "Owner/Repo", filled: [{ name: "A", environment: "development" }] });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps the single-secret wording for a batch of one write", async () => {
    const { prompt, many } = make();
    await many([{ name: "ONLY", value: "v", environment: "preview" }]);
    expect(prompt).toHaveBeenLastCalledWith("let a thread add ONLY (Owner/Repo, preview)");
  });

  it("refuses a bad list before any prompt", async () => {
    const { prompt, many } = make();
    await expect(many([])).rejects.toThrow(/at least one/);
    await expect(many("A")).rejects.toThrow(/at least one/);
    await expect(many(Array.from({ length: 21 }, (_, i) => ({ name: `K${i}`, value: "v" })))).rejects.toThrow(/At most 20/);
    await expect(many([{ name: " ", value: "v" }])).rejects.toThrow(/needs a name/);
    await expect(many([{ name: "A" }])).rejects.toThrow(/Give a value for A/);
    await expect(many([{ name: "A", value: "1" }, { name: "A", value: "2" }])).rejects.toThrow(/A \(development\) is in the list twice/);
    expect(prompt).not.toHaveBeenCalled();
  });
});

// A card whose grant names writes (electron/vault-grants.cjs) stores its batch without asking again, as set does,
// unless the batch overwrites a value.
describe("POST /secrets/set-many under a grant that names writes", () => {
  function granted() {
    const m = make();
    const routes = vaultRoutes(() => m.vault, () => "c1") as unknown as Record<string, (body: Record<string, unknown>, route?: string) => Promise<unknown>>;
    const many = (secrets: unknown) => routes["POST /secrets/set-many"]!({ folder: m.folder, secrets }, "/secrets/set-many");
    return { ...m, many };
  }

  it("adds and fills without a Touch ID", async () => {
    const { vault, folder, prompt, many, values } = granted();
    await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
    prompt.mockClear();
    expect(await many([{ name: "A", value: "a" }, { name: "B", value: "b" }])).toMatchObject({ ok: true, added: [{ name: "A" }, { name: "B" }] });
    expect(prompt).not.toHaveBeenCalled();
    expect(await values(["A", "B"])).toEqual({ A: "a", B: "b" });
  });

  it("still asks when the batch overwrites", async () => {
    const { vault, folder, prompt, many } = granted();
    await vault.setValue(folder, "OLD", "development", "old");
    await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
    prompt.mockClear();
    await many([{ name: "NEW", value: "n" }, { name: "OLD", value: "o", replace: true }]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
