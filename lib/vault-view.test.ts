import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askAnswered,
  secretAskOf,
  blankTitle,
  canManage,
  manageOffer,
  takeOver,
  writeBackText,
  environmentsOf,
  toggleEnvironment,
  copiedText,
  defaultPicks,
  filterOptions,
  filterVaults,
  groupSecrets,
  importGroups,
  importLabel,
  masked,
  nudgeText,
  picksOf,
  railBadge,
  railTitle,
  saveLabel,
  secretMenu,
  secretKey,
  trackedWarning,
  validName,
  vaultBridge,
  vaultFilter,
  type ImportScan,
  type VaultSecret,
  type VaultSummary,
  type VaultBridge,
} from "./vault-view";

const secret = (name: string, environment: VaultSecret["environment"], over: Partial<VaultSecret> = {}): VaultSecret => ({
  name,
  environment,
  missing: false,
  tail: "abcd",
  updatedAt: "",
  ...over,
});

const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({ id: "v", label: "o/r", folder: "/p", folders: ["/p"], secrets: [], nudge: null, ...over });

const scan: ImportScan = {
  id: "v",
  label: "o/r",
  files: [
    { file: ".env", environment: "development", namesOnly: false, tracked: true, vercel: false },
    { file: ".env.example", environment: "development", namesOnly: true, tracked: true, vercel: false },
    { file: ".env.local", environment: "development", namesOnly: false, tracked: false, vercel: false },
    { file: ".env.preview", environment: "preview", namesOnly: false, tracked: false, vercel: false },
  ],
  rows: [
    { file: ".env", name: "SHARED", environment: "development", status: "new", tail: "", public: false, ticked: false, skipped: false },
    { file: ".env.local", name: "A", environment: "development", status: "new", tail: "1111", public: false, ticked: true, skipped: false },
    { file: ".env.example", name: "B", environment: "development", status: "missing", tail: "", public: false, ticked: true, skipped: false },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("vault view", () => {
  it("toggles an environment, keeping the drawer's order", () => {
    expect(toggleEnvironment(["production"], "development")).toEqual(["development", "production"]);
    expect(toggleEnvironment(["development", "production"], "development")).toEqual(["production"]);
    expect(toggleEnvironment([], "preview")).toEqual(["preview"]);
  });

  it("lists the environments a name is in", () => {
    const secrets = [
      { name: "A", environment: "production" as const },
      { name: "B", environment: "preview" as const },
      { name: "A", environment: "development" as const },
    ];
    expect(environmentsOf(secrets, "A")).toEqual(["development", "production"]);
    expect(environmentsOf(secrets, "C")).toEqual([]);
  });

  it("groups secrets by environment in order, with blanks first within each", () => {
    const groups = groupSecrets([secret("Z", "production"), secret("B", "development"), secret("A", "development")]);
    expect(groups.map((g) => `${g.id},${g.label},${g.secrets.map((s) => s.name).join("|")}`)).toContain("development,Development,A|B");
    const withBlanks = groupSecrets([secret("Z", "production"), secret("B", "development", { missing: true }), secret("A", "development"), secret("M", "development", { missing: true })]);
    expect(withBlanks.map((g) => [g.id, g.label, g.secrets.map((s) => s.name)])).toEqual([
      ["development", "Development", ["B", "M", "A"]],
      ["production", "Production", ["Z"]],
    ]);
    expect(secretKey(secret("A", "preview"))).toBe("preview\nA");
  });

  it("names the Add button (blank, value, many environments)", () => {
    expect(saveLabel({ fixed: true, value: "x", environments: ["development"], from: "development" }, true)).toBe("Save");
    // Changing a secret: its own environment saves, another moves it, several save to each.
    expect(saveLabel({ fixed: true, value: "x", environments: ["production"], from: "production" }, true)).toBe("Save");
    expect(saveLabel({ fixed: true, value: "x", environments: ["development"], from: "production" }, true)).toBe("Move to Development");
    expect(saveLabel({ fixed: true, value: "x", environments: ["development", "production"], from: "production" }, true)).toBe("Save to 2 environments");
    expect(saveLabel({ fixed: false, value: "", environments: ["development"] }, true)).toBe("Add blank");
    expect(saveLabel({ fixed: false, value: "", environments: ["development", "preview", "production"] }, true)).toBe("Add 3 blanks");
    expect(saveLabel({ fixed: false, value: "x", environments: ["development"] }, true)).toBe("Add to vault");
    expect(saveLabel({ fixed: false, value: "x", environments: ["development", "production"] }, true)).toBe("Add to 2 environments");
    // An older shell without addBlank can't save an empty value.
    expect(saveLabel({ fixed: false, value: "", environments: ["development"] }, false)).toBe("Add to vault");
  });

  it("writes a blank's tooltip from who added it and where to get its value", () => {
    expect(blankTitle({ name: "K" })).toBe("K has no value yet.\nClick Fill in to paste it.");
    expect(blankTitle({ name: "K", source: "a thread" })).toBe("K has no value yet (added by a thread).\nClick Fill in to paste it.");
    expect(blankTitle({ name: "K", source: ".env.example", hint: "Stripe dashboard → API keys" })).toBe("K has no value yet (added by .env.example).\nStripe dashboard → API keys\nClick Fill in to paste it.");
  });

  it("masks values and marks missing ones", () => {
    expect(masked(secret("A", "development"))).toBe("••••abcd");
    expect(masked({ tail: "" })).toBe("••••");
    expect(masked(secret("A", "development", { missing: true }))).toBe("blank");
  });

  it("counts missing names and nudges for files to import", () => {
    expect(railBadge([])).toEqual({ missing: 0, nudge: false });
    const badge = railBadge([vault({ secrets: [secret("A", "development", { missing: true }), secret("B", "development")] }), vault({ nudge: { count: 2, file: ".env.local" } })]);
    expect(badge).toEqual({ missing: 1, nudge: true });
    expect(railTitle(badge)).toBe("Secrets: this project's vault · 1 blank to fill in · .env.local has values to import");
    expect(railTitle({ missing: 0, nudge: false })).toBe("Secrets: this project's vault");
    expect(railTitle({ missing: 3, nudge: false })).toBe("Secrets: this project's vault · 3 blanks to fill in");
    expect(railTitle({ missing: 0, nudge: false, vercel: "vault is ahead of Vercel" })).toBe("Secrets: this project's vault · vault is ahead of Vercel");
    expect(nudgeText({ count: 14, file: ".env.local" })).toBe("Found 14 secrets in .env.local: move them into the vault?");
    expect(nudgeText({ count: 1, file: "apps/web/.env.local" })).toBe("Found 1 secret in apps/web/.env.local: move it into the vault?");
    expect(nudgeText({ count: 1, file: ".env.local", managed: true })).toBe("You edited .env.local: import the change into the vault?");
    expect(nudgeText({ count: 3, file: ".env.local", managed: true })).toBe("You edited .env.local: import 3 changes into the vault?");
  });

  it("offers to manage .env.local once, and says how the write-back went", () => {
    const file = (name: string) => ({ file: name, environment: "development" as const, namesOnly: false, tracked: false, vercel: false });
    const scanOf = (...names: string[]) => ({ id: "v", label: "o/r", files: names.map(file), rows: [] });
    expect(canManage(scanOf(".env", ".env.local"), false)).toBe(true);
    expect(canManage(scanOf(".env.local"), true)).toBe(false);
    expect(canManage(scanOf("apps/web/.env.local", ".env"), false)).toBe(false);
    expect(writeBackText({ written: true, file: ".env.local", gitignoreAdded: false })).toBe("Weft now writes .env.local from the vault.");
    expect(writeBackText({ written: true, file: ".env.local", gitignoreAdded: true })).toBe("Weft now writes .env.local from the vault (and added .env*.local to .gitignore).");
    expect(writeBackText({ refused: "git tracks .env.local." })).toBe(".env.local stays as it is: git tracks .env.local.");
  });

  it("offers the take-over only with a shell that can write it back, and runs it only when ticked", async () => {
    const scan = { id: "v", label: "o/r", files: [{ file: ".env.local", environment: "development" as const, namesOnly: false, tracked: false, vercel: false }], rows: [] };
    const writeBack = vi.fn(() => Promise.resolve({ written: true as const, file: ".env.local", gitignoreAdded: false }));
    const old = {} as VaultBridge;
    const bridge = { writeBack } as unknown as VaultBridge;
    expect(manageOffer(bridge, scan, undefined)).toBe(true);
    expect(manageOffer(bridge, scan, true)).toBeNull();
    expect(manageOffer(old, scan, false)).toBeNull();
    expect(await takeOver(bridge, "/p", false)).toBeNull();
    expect(await takeOver(bridge, "/p", null)).toBeNull();
    expect(await takeOver(old, "/p", true)).toBeNull();
    expect(await takeOver(bridge, "/p", true)).toBe("Weft now writes .env.local from the vault.");
    expect(writeBack).toHaveBeenCalledWith("/p");
  });

  it("groups the import preview by file and picks the ticked rows", () => {
    expect(importGroups(scan).map((g) => [g.file, g.rows.map((r) => r.name)])).toEqual([
      [".env", ["SHARED"]],
      [".env.example", ["B"]],
      [".env.local", ["A"]],
    ]);
    const picked = defaultPicks(scan);
    expect([...picked]).toEqual([".env.local\nA", ".env.example\nB"]);
    expect(picksOf(scan, picked)).toEqual([
      { file: ".env.local", name: "A" },
      { file: ".env.example", name: "B" },
    ]);
    expect(importLabel(2)).toBe("Import 2");
    expect(importLabel(0)).toBe("Nothing picked");
  });

  it("warns about files git tracks", () => {
    expect(trackedWarning(scan)).toBe("git tracks .env, so its values are in history: rotate them at the provider, not just import.");
    const two = { ...scan, files: scan.files.map((f) => ({ ...f, tracked: true })) };
    expect(trackedWarning(two)).toMatch(/^git tracks .env, .env.local, .env.preview, so their values/);
    expect(trackedWarning({ ...scan, files: [] })).toBeNull();
  });

  it("offers reveal and copy only for secrets with a value, and a copy to each other project", () => {
    const ids = (items: ReturnType<typeof secretMenu>) => items.map((i) => ("id" in i ? i.id : i.type));
    expect(secretMenu({ missing: true })).toEqual([{ id: "edit", label: "Fill In Value…" }, { type: "separator" }, { id: "remove", label: "Remove from Vault…" }]);
    expect(ids(secretMenu({ missing: false }))).toEqual(["reveal", "copy", "edit", "separator", "remove"]);
    const menu = secretMenu({ missing: false }, [{ folder: "/b", label: "o/b" }, { folder: "/c", label: "c" }]);
    expect(ids(menu)).toEqual(["reveal", "copy", "edit", "separator", "copy-to:/b", "copy-to:/c", "separator", "remove"]);
    expect(menu[4]).toEqual({ id: "copy-to:/b", label: "Copy to o/b" });
  });

  it("checks variable names", () => {
    expect(validName("API_KEY")).toBe(true);
    expect(validName("_x1")).toBe(true);
    expect(validName("1X")).toBe(false);
    expect(validName("A-B")).toBe(false);
    expect(validName("")).toBe(false);
  });

  it("filters to the top bar's project until you pick another, and follows the top bar again when it changes", () => {
    expect(vaultFilter(null, null)).toBeNull();
    expect(vaultFilter("/a", null)).toBe("/a");
    expect(vaultFilter("/a", { top: "/a", folder: null })).toBeNull();
    expect(vaultFilter("/a", { top: "/a", folder: "/b" })).toBe("/b");
    expect(vaultFilter("/c", { top: "/a", folder: "/b" })).toBe("/c");
    expect(vaultFilter(null, { top: null, folder: "/b" })).toBe("/b");
  });

  it("shows the vault holding the folder, or every vault, and lists them by name", () => {
    const a = vault({ id: "a", label: "zed", folder: "/a", folders: ["/a", "/a2"] });
    const b = vault({ id: "b", label: "alpha", folder: "/b", folders: ["/b"] });
    expect(filterVaults([a, b], null)).toEqual([a, b]);
    expect(filterVaults([a, b], "/a2")).toEqual([a]);
    expect(filterVaults([a, b], "/nope")).toEqual([]);
    expect(filterOptions([a, b])).toEqual([
      { folder: "", label: "All projects" },
      { folder: "/b", label: "alpha" },
      { folder: "/a", label: "zed" },
    ]);
  });

  it("reads a thread's ask_add call, and whether its folder's vault has the value", () => {
    expect(secretAskOf("mcp__secrets__ask_add", { name: "SUPABASE_SECRET_KEY", environment: "preview" }, "/cwd")).toEqual({
      folder: "/cwd",
      name: "SUPABASE_SECRET_KEY",
      environment: "preview",
    });
    expect(secretAskOf("mcp__secrets__ask_add", { name: "K", environment: "staging", project: "/other" }, "/cwd")).toEqual({ folder: "/other", name: "K", environment: "development" });
    expect(secretAskOf("mcp__secrets__ask_add", { name: "K", project: "" }, "/cwd")?.folder).toBe("/cwd");
    expect(secretAskOf("mcp__secrets__ask_add", { name: "1BAD" }, "/cwd")).toBeUndefined();
    expect(secretAskOf("mcp__secrets__ask_add", {}, "/cwd")).toBeUndefined();
    expect(secretAskOf("Bash", { name: "K" }, "/cwd")).toBeUndefined();

    const secret = (name: string, environment: VaultSecret["environment"], missing: boolean): VaultSecret => ({ name, environment, missing, tail: "", updatedAt: "" });
    const a = vault({ id: "a", folder: "/a", folders: ["/a", "/a2"], secrets: [secret("K", "development", false), secret("B", "development", true)] });
    const ask = { folder: "/a2", name: "K", environment: "development" as const };
    expect(askAnswered([a], ask)).toBe(true);
    expect(askAnswered([a], { ...ask, environment: "production" })).toBe(false);
    expect(askAnswered([a], { ...ask, name: "B" })).toBe(false);
    expect(askAnswered([a], { ...ask, folder: "/nope" })).toBe(false);
  });

  it("says whether a copy added or replaced", () => {
    expect(copiedText("A", { label: "o/r", replaced: false })).toBe("Copied A in o/r");
    expect(copiedText("A", { label: "o/r", replaced: true })).toBe("Replaced A in o/r");
  });

  it("finds the bridge in the desktop shell only", () => {
    expect(vaultBridge()).toBeNull();
    vi.stubGlobal("window", {});
    expect(vaultBridge()).toBeNull();
    const bridge = { overview: vi.fn() };
    vi.stubGlobal("window", { weft: { vault: bridge } });
    expect(vaultBridge()).toBe(bridge);
  });
});
