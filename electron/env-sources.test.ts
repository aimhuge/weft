import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ANY_FILE, copyName, createLocated, elsewhereFiles, locateFile, nearbyFolders, openEnvDialog, readEnvFiles, valuedIn, worktrees } from "./env-sources.cjs";

// electron/env-sources.cjs: the env files a vault reads from beside its project, and the ones you locate.

function tree(files: Record<string, string>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-sources-")));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe("copyName", () => {
  it("matches a name plus a separator and more, either way round", () => {
    expect(copyName("weft", "weft-build")).toBe(true);
    expect(copyName("weft-build", "weft")).toBe(true);
    expect(copyName("app", "app.old")).toBe(true);
    expect(copyName("app", "app_2")).toBe(true);
    expect(copyName("weft", "weftly")).toBe(false);
    expect(copyName("weft", "weft")).toBe(false);
    expect(copyName("weft", "other")).toBe(false);
  });
});

describe("worktrees", () => {
  it("lists the main checkout and its worktrees, from either side", () => {
    const root = tree({
      "main/.git/HEAD": "ref: refs/heads/main\n",
      "main/.git/worktrees/feature/gitdir": "", // filled below with the real path
      "feature/.git": "", // a worktree's .git file
    });
    fs.writeFileSync(path.join(root, "main/.git/worktrees/feature/gitdir"), path.join(root, "feature/.git") + "\n");
    fs.writeFileSync(path.join(root, "feature/.git"), `gitdir: ${path.join(root, "main/.git/worktrees/feature")}\n`);
    fs.mkdirSync(path.join(root, "main/.git/worktrees/empty"));
    expect(worktrees(path.join(root, "main"))).toEqual([path.join(root, "main"), path.join(root, "feature")]);
    expect(worktrees(path.join(root, "feature"))).toEqual([path.join(root, "main"), path.join(root, "feature")]);
  });

  it("finds nothing outside a git checkout", () => {
    expect(worktrees(tree({ "a.txt": "" }))).toEqual([]);
  });
});

describe("nearbyFolders", () => {
  it("lists copies beside the project, never itself, nor a skipped folder or a plain file", () => {
    const root = tree({ "weft/x": "", "weft-build/x": "", "weft.old/x": "", "weftly/x": "", "other/x": "", "weft-file": "", "pool/weft-wt/x": "" });
    expect(nearbyFolders(path.join(root, "weft")).sort()).toEqual([path.join(root, "weft-build"), path.join(root, "weft.old")]);
    expect(nearbyFolders(path.join(root, "weft"), { skip: [path.join(root, "weft.old")] })).toEqual([path.join(root, "weft-build")]);
  });

  it("caps how many it looks in", () => {
    const files: Record<string, string> = { "p/x": "" };
    for (let i = 0; i < 20; i++) files[`p-${i}/x`] = "";
    expect(nearbyFolders(path.join(tree(files), "p"))).toHaveLength(12);
  });
});

describe("createLocated", () => {
  it("remembers files per vault, once each, and survives a broken file", () => {
    const file = path.join(tree({}), "deep", "env-sources.json");
    const located = createLocated({ file });
    expect(located.get("v")).toEqual([]);
    located.add("v", "/a/.env");
    located.add("v", "/a/.env");
    located.add("w", "/b/.env");
    expect(located.get("v")).toEqual(["/a/.env"]);
    expect(createLocated({ file }).get("w")).toEqual(["/b/.env"]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file, '{"v": "nope"}');
    expect(located.get("v")).toEqual([]);
    located.add("v", "/c/.env");
    expect(located.get("v")).toEqual(["/c/.env"]);
    fs.writeFileSync(file, "null");
    expect(located.get("v")).toEqual([]);
    fs.writeFileSync(file, "not json");
    expect(located.get("v")).toEqual([]);
  });
});

describe("elsewhereFiles and readEnvFiles", () => {
  it("reads the project's own files, then located ones, then copies' valued files, each once", () => {
    const root = tree({
      "weft/.env.example": "A=\n",
      "weft/.env.local": "OWN=1\n",
      "weft-build/.env.local": "A=from-build\n",
      "weft-build/.env.example": "IGNORED=\n",
      "weft-build/.env.production": "P=1\n",
      "keys/secrets.env": "S=1\n",
      "keys/.env.production.local": "PROD=1\n",
    });
    const folder = path.join(root, "weft");
    const located = [path.join(root, "keys/secrets.env"), path.join(root, "keys/.env.production.local"), path.join(root, "weft-build/.env.local"), path.join(root, "gone/.env"), path.join(folder, ".env.local")];
    expect(elsewhereFiles(folder, located)).toEqual([
      { file: "../keys/secrets.env", kind: ANY_FILE },
      { file: "../keys/.env.production.local", kind: { environment: "production", namesOnly: false, ticked: true } },
      { file: "../weft-build/.env.local", kind: { environment: "development", namesOnly: false, ticked: true } },
      { file: "../weft-build/.env.production", kind: { environment: "production", namesOnly: false, ticked: true } },
    ]);
    const read = readEnvFiles(folder, located);
    expect(read.map((f: { file: string; elsewhere: boolean }) => `${f.elsewhere ? "+" : ""}${f.file}`)).toEqual([
      ".env.example",
      ".env.local",
      "+../keys/secrets.env",
      "+../keys/.env.production.local",
      "+../weft-build/.env.local",
      "+../weft-build/.env.production",
    ]);
    expect(read[4]).toMatchObject({ vercel: false, entries: [{ name: "A", value: "from-build" }] });
    expect(readEnvFiles(folder).map((f: { file: string }) => f.file)).toContain("../weft-build/.env.local");
  });

  it("skips a file that vanishes between finding and reading it", () => {
    const root = tree({ "app/.env.local": "A=1\n" });
    const real = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith(".local")) throw new Error("gone");
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    expect(readEnvFiles(path.join(root, "app"))).toEqual([]);
    spy.mockRestore();
  });
});

describe("valuedIn", () => {
  it("keys every value by environment and name, skipping names-only files", () => {
    const kind = (namesOnly: boolean) => ({ environment: "development", namesOnly });
    expect([...valuedIn([{ kind: kind(false), entries: [{ name: "A" }] }, { kind: kind(true), entries: [{ name: "B" }] }])]).toEqual(["development\nA"]);
  });
});

describe("locateFile", () => {
  const setup = (files: Record<string, string>) => {
    const root = tree(files);
    const located = { add: vi.fn() };
    const log = vi.fn(() => true);
    return { root, located, log, folder: path.join(root, "app") };
  };

  it("keeps a picked file with values, logs it and answers its path from the project", async () => {
    const { root, located, log, folder } = setup({ "app/x": "", "elsewhere/prod.env": "A=1\n" });
    const pickFile = vi.fn(() => Promise.resolve(path.join(root, "elsewhere/prod.env")));
    expect(await locateFile({ pickFile, located, id: "v", folder, label: "App", log })).toEqual({ file: "../elsewhere/prod.env" });
    expect(pickFile).toHaveBeenCalledWith({ title: "Locate an env file for App", defaultPath: root });
    expect(located.add).toHaveBeenCalledWith("v", path.join(root, "elsewhere/prod.env"));
    expect(log).toHaveBeenCalledWith({ action: "locate", by: "you", vault: "App", names: [], detail: "../elsewhere/prod.env" });
  });

  it("answers null when you cancel, and refuses a file with no NAME=value lines", async () => {
    const { root, located, folder } = setup({ "app/x": "", "id_rsa": "-----BEGIN KEY-----\n" });
    expect(await locateFile({ pickFile: () => Promise.resolve(null), located, id: "v", folder, label: "App" })).toBeNull();
    expect(await locateFile({ pickFile: () => Promise.resolve(path.join(root, "id_rsa")), located, id: "v", folder, label: "App" })).toEqual({ empty: true, file: "id_rsa" });
    expect(await locateFile({ pickFile: () => Promise.resolve(path.join(root, "missing")), located, id: "v", folder, label: "App" })).toEqual({ empty: true, file: "missing" });
    expect(located.add).not.toHaveBeenCalled();
  });
});

describe("openEnvDialog", () => {
  it("opens main's file dialog with hidden files shown, and answers the path or null", async () => {
    const win = { id: 1 };
    const dialog = { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: ["/x/.env"] })) };
    const pick = openEnvDialog(dialog, () => win);
    expect(await pick({ title: "T", defaultPath: "/x" })).toBe("/x/.env");
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(win, { title: "T", defaultPath: "/x", buttonLabel: "Use This File", properties: ["openFile", "showHiddenFiles"] });
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await pick({ title: "T", defaultPath: "/x" })).toBeNull();
  });
});
