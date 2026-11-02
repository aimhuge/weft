import { describe, expect, it } from "vitest";
import * as cjs from "../electron/worker-vault-wire.cjs";
import { DEV_ENV, devEnvPurpose, VAULT_BLANK, VAULT_LIST, VAULT_PUSH, VAULT_SET, VAULT_TOOLS, vaultAskMessage, type VaultAsk } from "./worker-vault-wire";

const base: VaultAsk = { nonce: "a".repeat(64), expiresAt: 5, remote: "git@github.com:o/r.git" };

describe("the vault ask's wire", () => {
  it("names the same tools on both sides", () => {
    expect([...VAULT_TOOLS]).toEqual([VAULT_LIST, VAULT_BLANK, VAULT_SET, VAULT_PUSH, DEV_ENV]);
    expect([...cjs.VAULT_TOOLS]).toEqual([...VAULT_TOOLS]);
  });

  it.each([
    base,
    { ...base, environment: "preview", names: ["A", "B"], hint: "Stripe" },
    { ...base, name: "A", replace: true, sealed: "c2VhbGVk" },
    { ...base, command: "pnpm dev", cwd: ".", script: "next dev" },
  ])("signs the same message on both sides", (a) => {
    expect(cjs.vaultAskMessage("c1", "box", VAULT_SET, a)).toBe(vaultAskMessage("c1", "box", VAULT_SET, a));
  });

  it("covers every field main acts on, and not the thread's own words", () => {
    const m = vaultAskMessage("c1", "box", VAULT_BLANK, base);
    for (const change of [{ remote: "x" }, { names: ["Z"] }, { hint: "h" }, { replace: true }, { sealed: "s" }, { command: "c" }, { script: "s" }, { cwd: "d" }, { environment: "preview" }, { name: "N" }])
      expect(vaultAskMessage("c1", "box", VAULT_BLANK, { ...base, ...change })).not.toBe(m);
    expect(vaultAskMessage("c2", "box", VAULT_BLANK, base)).not.toBe(m);
    expect(vaultAskMessage("c1", "other", VAULT_BLANK, base)).not.toBe(m);
    expect(vaultAskMessage("c1", "box", VAULT_LIST, base)).not.toBe(m);
    expect(vaultAskMessage("c1", "box", VAULT_BLANK, { ...base, thread: "t", why: "w" } as VaultAsk)).toBe(m);
  });

  it("binds a dev env to its card, ask and command", () => {
    expect(cjs.devEnvPurpose("c", "n", "pnpm dev")).toBe(devEnvPurpose("c", "n", "pnpm dev"));
    expect(devEnvPurpose("c", "n", "pnpm dev")).toMatch(/^dev-env:c:n:[0-9a-f]{64}$/);
    expect(devEnvPurpose("c", "n", "pnpm start")).not.toBe(devEnvPurpose("c", "n", "pnpm dev"));
  });
});
