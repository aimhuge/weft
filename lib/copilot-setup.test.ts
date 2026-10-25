import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/copilot-setup.ts: every gap the copilot's setup_status tool can report, the lines it shows, and the
// "Everything Weft can link" reply when there is nothing to do. statusOf and gh (via execFile) are mocked per
// case; analyticsTools/dependencies/within stay real against temp project folders; DATA_DIR is a temp dir.

const h = vi.hoisted(() => ({
  dir: "",
  execFile: vi.fn<(cmd: string, args: string[], opts: unknown, cb: (err: unknown) => void) => void>(),
  accountView: vi.fn(),
  shell: vi.fn(),
  statusOf: vi.fn(),
}));
h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-copilot-setup-"));
process.env.WEFT_DATA = h.dir;
afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

vi.mock("node:child_process", () => ({ execFile: h.execFile }));
vi.mock("./store", () => ({ get DATA_DIR() { return h.dir; } }));
vi.mock("./account", () => ({ accountView: h.accountView }));
vi.mock("./browser-tools", () => ({ shell: h.shell }));
vi.mock("./project-seed-run", () => ({ seedChipLines: vi.fn(async (p: readonly string[]) => p.map((x) => `- ${x}: starter`)) }));
vi.mock("./copilot-sources", async (orig) => ({ ...(await orig<typeof import("./copilot-sources")>()), statusOf: h.statusOf }));

const signedOut = { configured: true, user: null };
const unconfigured = { configured: false, user: null };
const signedIn = { id: "u1", email: "a@b.co" };

const mkDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weft-cs-"));
const webProject = (extra: Record<string, string> = {}, files: string[] = []): string => {
  const d = mkDir();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { next: "1.0.0", ...extra } }));
  for (const f of files) {
    const full = path.join(d, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
  }
  return d;
};
const nonWeb = (): string => {
  const d = mkDir();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { "left-pad": "1.0.0" } }));
  return d;
};
const dataPath = (n: string) => path.join(h.dir, n);
const writeCfToken = () => fs.writeFileSync(dataPath("cloudflare-token.json"), "{}");
const writeCfLinks = (links: Record<string, unknown>) => fs.writeFileSync(dataPath("cloudflare-links.json"), JSON.stringify(links));
const okGh = (_c: unknown, _a: unknown, _o: unknown, cb: (e: unknown) => void) => cb(null);
const badGh = (_c: unknown, _a: unknown, _o: unknown, cb: (e: unknown) => void) => cb(new Error("nope"));
const loadSetup = async () => { vi.resetModules(); return import("./copilot-setup"); };
// Identity helper for tests that read like "gaps(...)" — keep the variable referenced so lint passes.
const gaps = <T>(x: T): T => x;
const vercelStatus = (root: string, link: unknown) => (r: string) =>
  r === "/vercel/status" ? Promise.resolve({ signedIn: true, folders: [{ folder: root, link }] }) : Promise.resolve(null);
const vercelNotSigned = () => (r: string) =>
  r === "/vercel/status" ? Promise.resolve({ signedIn: false, folders: [] }) : Promise.resolve(null);
const supaStatus = (root: string, signedIn: boolean, link: unknown) => (r: string) =>
  r === "/supabase/status" ? Promise.resolve({ signedIn, folders: [{ folder: root, link }] }) : Promise.resolve(null);
const supaSignedOut = () => (r: string) =>
  r === "/supabase/status" ? Promise.resolve({ signedIn: false, folders: [] }) : Promise.resolve(null);

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(dataPath("cloudflare-token.json"), { force: true });
  fs.rmSync(dataPath("cloudflare-links.json"), { force: true });
  h.execFile.mockImplementation(okGh);
  h.statusOf.mockImplementation(() => Promise.resolve(null));
  h.accountView.mockResolvedValue(unconfigured);
  h.shell.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("account", () => {
  it("configured but signed out is a gap", async () => {
    h.accountView.mockResolvedValue(signedOut);
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "Weft account")).toBeTruthy();
  });
  it("unconfigured is silent", async () => {
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "Weft account")).toBeUndefined();
  });
  it("signed in is silent", async () => {
    h.accountView.mockResolvedValue({ configured: true, user: signedIn });
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "Weft account")).toBeUndefined();
  });
  it("rejection is left out", async () => {
    h.accountView.mockRejectedValue(new Error("offline"));
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "Weft account")).toBeUndefined();
  });
});

describe("github cli", () => {
  it("gh error is a gap", async () => {
    h.execFile.mockImplementation(badGh);
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "GitHub CLI sign-in")).toBeTruthy();
  });
  it("gh success is silent", async () => {
    expect(gaps(await (await loadSetup()).setupGaps([])).find((g) => g.what === "GitHub CLI sign-in")).toBeUndefined();
  });
  it("default ghSignedIn (no deps) calls execFile with auth status", async () => {
    await (await loadSetup()).setupGaps([]);
    expect(h.execFile).toHaveBeenCalledWith("gh", ["auth", "status"], expect.objectContaining({ timeout: 5_000 }), expect.any(Function));
  });
});

describe("vercel", () => {
  it("token gap when not signed in and any project is web", async () => {
    const r = webProject();
    h.statusOf.mockImplementation(vercelNotSigned());
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Vercel token")).toBeTruthy();
  });
  it("token gap is silent for non-web projects", async () => {
    h.statusOf.mockImplementation(vercelNotSigned());
    expect(gaps(await (await loadSetup()).setupGaps([nonWeb()])).find((g) => g.what === "Vercel token")).toBeUndefined();
  });
  it("vercel left out when status rejects", async () => {
    h.statusOf.mockImplementation((r) => r === "/vercel/status" ? Promise.reject(new Error("down")) : Promise.resolve(null));
    expect(gaps(await (await loadSetup()).setupGaps([webProject()])).find((g) => g.what === "Vercel token")).toBeUndefined();
  });
  it("link gap when signed in but folder unlinked", async () => {
    const r = webProject();
    h.statusOf.mockImplementation(vercelStatus(r, null));
    const link = gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Vercel project link");
    expect(link).toBeTruthy();
    expect(link?.project).toBe(path.basename(r));
  });
  it("silent when folder is already linked", async () => {
    const r = webProject();
    h.statusOf.mockImplementation(vercelStatus(r, { name: "x" }));
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Vercel project link")).toBeUndefined();
  });
  it("no link gap for a non-web folder", async () => {
    const r = nonWeb();
    h.statusOf.mockImplementation(vercelStatus(r, null));
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Vercel project link")).toBeUndefined();
  });
});

describe("vercel drift", () => {
  it("lists a drifted project's names from main's cache", async () => {
    const rows = [{ name: "KEY", environment: "preview", inVault: false, onVercel: true, pullable: true }];
    h.shell.mockImplementation((route: string) => Promise.resolve(route === "/vercel/env-drift" ? [{ folder: "/dev/web", label: "o/web", project: "web", rows }] : {}));
    const g = gaps(await (await loadSetup()).setupGaps(["/dev/web"])).find((x) => x.what.startsWith("vault ⇄ Vercel"));
    expect(g).toMatchObject({ project: "web", what: "vault ⇄ Vercel env sync (1 Vercel env vars not in the 🔐 vault (KEY))" });
    expect(h.shell).toHaveBeenCalledWith("/vercel/env-drift", { folders: ["/dev/web"] });
  });
  it("is left out when main can't answer", async () => {
    h.shell.mockRejectedValue(new Error("no pane"));
    expect(gaps(await (await loadSetup()).setupGaps(["/dev/web"])).find((x) => x.what.startsWith("vault ⇄ Vercel"))).toBeUndefined();
  });
});

describe("supabase", () => {
  it("token gap when signed out and web project uses supabase-js", async () => {
    const r = webProject({ "@supabase/supabase-js": "2.0.0" });
    h.statusOf.mockImplementation(supaSignedOut());
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "Supabase token");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("link gap when signed in but folder unlinked", async () => {
    const r = webProject({ "@supabase/supabase-js": "2.0.0" });
    h.statusOf.mockImplementation(supaStatus(r, true, null));
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "Supabase project link");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("left out when supabase status rejects", async () => {
    const r = webProject({ "@supabase/supabase-js": "2.0.0" });
    h.statusOf.mockImplementation((x) => x === "/supabase/status" ? Promise.reject(new Error("down")) : Promise.resolve(null));
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Supabase token" || g.what === "Supabase project link")).toBeUndefined();
  });
  it("detects supabase from a supabase/ folder even without a dep", async () => {
    const r = webProject({}, ["supabase/migrations/0001_init.sql"]);
    h.statusOf.mockImplementation(supaSignedOut());
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Supabase token")).toBeTruthy();
  });
  it("not flagged for a web project without supabase", async () => {
    h.statusOf.mockImplementation(supaSignedOut());
    expect(gaps(await (await loadSetup()).setupGaps([webProject()])).find((g) => g.what === "Supabase token")).toBeUndefined();
  });
  it("not flagged when there is no package.json (dependencies() is null) and no supabase folder", async () => {
    h.statusOf.mockImplementation(supaSignedOut());
    expect(gaps(await (await loadSetup()).setupGaps([mkDir()])).find((g) => g.what === "Supabase token")).toBeUndefined();
  });
});

describe("cloudflare", () => {
  it("token gap when wrangler.toml exists but no token", async () => {
    const r = webProject({}, ["wrangler.toml"]);
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "Cloudflare token");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("link gap when token exists but folder isn't linked", async () => {
    writeCfToken();
    const r = webProject({}, ["wrangler.toml"]);
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "Cloudflare Worker link");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("silent when token and link both exist", async () => {
    writeCfToken();
    const r = webProject({}, ["wrangler.toml"]);
    writeCfLinks({ [r]: { name: "x" } });
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Cloudflare token" || g.what === "Cloudflare Worker link")).toBeUndefined();
  });
  it("silent when no wrangler config is present", async () => {
    expect(gaps(await (await loadSetup()).setupGaps([webProject()])).find((g) => g.what === "Cloudflare token" || g.what === "Cloudflare Worker link")).toBeUndefined();
  });
  it("reads a broken cloudflare-links.json as empty", async () => {
    writeCfToken();
    fs.writeFileSync(dataPath("cloudflare-links.json"), "{nope");
    const r = webProject({}, ["wrangler.toml"]);
    expect(gaps(await (await loadSetup()).setupGaps([r])).find((g) => g.what === "Cloudflare Worker link")).toBeTruthy();
  });
});

describe("analytics", () => {
  it("analytics gap when web project has none", async () => {
    const r = webProject();
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "analytics");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("silent for non-web project with no analytics", async () => {
    expect(gaps(await (await loadSetup()).setupGaps([nonWeb()])).find((g) => g.what === "analytics")).toBeUndefined();
  });
  it("GA4 Data API gap when only tool is gtag (GoogleAnalytics.tsx, no dep)", async () => {
    const r = webProject({}, ["components/GoogleAnalytics.tsx"]);
    const g = gaps(await (await loadSetup()).setupGaps([r])).find((x) => x.what === "GA4 Data API access");
    expect(g).toBeTruthy();
    expect(g?.project).toBe(path.basename(r));
  });
  it("silent when posthog is the only dep", async () => {
    expect(gaps(await (await loadSetup()).setupGaps([webProject({ "posthog-js": "1.0.0" })])).find((g) => g.what === "analytics" || g.what === "GA4 Data API access")).toBeUndefined();
  });
});

describe("gapLine, setup, SETUP_SOURCE", () => {
  it("gapLine without project", async () => {
    const { gapLine } = await loadSetup();
    expect(gapLine({ what: "W", why: "y", where: "z" })).toBe("- W not set up (gives y); link it at z");
  });
  it("gapLine with project", async () => {
    const { gapLine } = await loadSetup();
    expect(gapLine({ project: "acme", what: "W", why: "y", where: "z" })).toBe("- acme: W not set up (gives y); link it at z");
  });
  it("setup maps gaps through gapLine", async () => {
    h.accountView.mockResolvedValue(signedOut);
    const lines = await (await loadSetup()).setup([], []);
    expect(lines[0]).toMatch(/^- Weft account not set up/);
  });
  it("setup returns [] when nothing to do", async () => {
    expect(await (await loadSetup()).setup([], [])).toEqual([]);
  });
  it("SEED_SOURCE offers the starter cards as chip lines", async () => {
    const { SEED_SOURCE } = await loadSetup();
    expect(SEED_SOURCE.title).toBe("Starter work Weft found");
    expect(await SEED_SOURCE.source(["/r"], [])).toEqual(["- /r: starter"]);
  });

  it("SETUP_SOURCE shape", async () => {
    const { SETUP_SOURCE, setup } = await loadSetup();
    expect(SETUP_SOURCE.title).toBe("Not set up yet");
    expect(SETUP_SOURCE.ms).toBe(6_000);
    expect(SETUP_SOURCE.source).toBe(setup);
  });
});

describe("setupReport", () => {
  it("lists every gap, one per line", async () => {
    h.accountView.mockResolvedValue(signedOut);
    h.execFile.mockImplementation(badGh);
    const out = await (await loadSetup()).setupReport([]);
    expect(out).toContain("Weft account not set up");
    expect(out).toContain("GitHub CLI sign-in not set up");
    expect(out.split("\n").length).toBeGreaterThan(1);
  });
  it("'Everything Weft can link…' when nothing to do", async () => {
    expect(await (await loadSetup()).setupReport([])).toBe("Everything Weft can link for these projects is linked.");
  });
});

describe("deps injection", () => {
  it("uses passed ghSignedIn and accountView (skips execFile)", async () => {
    const ghSignedIn = vi.fn().mockResolvedValue(true);
    const accountViewLocal = vi.fn().mockResolvedValue(unconfigured);
    const { setupGaps } = await loadSetup();
    await setupGaps([], { ghSignedIn, accountView: accountViewLocal });
    expect(ghSignedIn).toHaveBeenCalledTimes(1);
    expect(accountViewLocal).toHaveBeenCalledTimes(1);
    expect(h.execFile).not.toHaveBeenCalled();
  });
});
