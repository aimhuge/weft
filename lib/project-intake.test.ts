import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// lib/project-intake.ts: what a project's files say (the env names its code reads, the .env.example names,
// the webhook routes it serves) and what Weft takes in from it (🪝 blanks, vault blanks, imported values),
// once per folder until HEAD or an .env file changes.
const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-tools", () => ({ shell }));

type VaultIntake = { imported?: { file: string; name: string }[]; blanked?: string[]; tracked?: string[]; keys?: string[] };

// One data dir for the whole file: lib/store.ts reads WEFT_DATA at import, so the modules below all
// share it and the webhooks store is the real one on disk.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "weft-intake-data-"));
process.env.WEFT_DATA = data;

const { scanProject, intakeProject, intakeText } = await import("./project-intake");
const { addWebhook, listWebhooks } = await import("./webhooks");

let repo: string;
let template: string;

// A real git repo: git ls-files and rev-parse HEAD are what the intake reads.
function git(...args: string[]) {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

function commit(message: string) {
  git("add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=Test", "commit", "-q", "--allow-empty", "-m", message);
}

// The first git in a process pays for warming up, so the repo template is made once and copied per test.
beforeAll(() => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), "weft-intake-template-"));
  execFileSync("git", ["-C", template, "init", "-q"], { stdio: "ignore" });
});

// A fresh project and a fresh store for every test.
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-intake-repo-"));
  fs.cpSync(path.join(template, ".git"), path.join(repo, ".git"), { recursive: true });
  for (const file of ["webhooks.json", "intake.json"]) fs.rmSync(path.join(data, file), { force: true });
  const g = globalThis as unknown as Record<string, Map<string, unknown> | undefined>;
  g.__weftIntakeSeen?.clear();
  g.__weftIntakeRunning?.clear();
  shell.mockReset();
  shell.mockResolvedValue({ imported: [], blanked: [], tracked: [], keys: [] } satisfies VaultIntake);
});

afterAll(() => fs.rmSync(data, { recursive: true, force: true }));

describe("scanProject", () => {
  it("finds the env names the code reads, with a provider hint or a plain note", async () => {
    write("src/app.ts", "const k = process.env.STRIPE_API_KEY;\nconst d = process.env.DATABASE_URL;\n");
    write("src/other.ts", "const t = process.env['GITHUB_TOKEN'];\n");
    commit("code");
    const { blanks } = await scanProject(repo);
    const byName = new Map(blanks.map((b) => [b.name, b]));
    expect(byName.get("STRIPE_API_KEY")?.hint).toMatch(/^Stripe .* \(read in src\/app\.ts\)$/);
    expect(byName.get("STRIPE_API_KEY")?.source).toBe("your code");
    expect(byName.get("DATABASE_URL")?.hint).toMatch(/^Your database's .* \(read in src\/app\.ts\)$/);
    expect(byName.get("GITHUB_TOKEN")?.hint).toMatch(/^GitHub .* \(read in src\/other\.ts\)$/);
  });

  it("gives a plain note to a name no provider is known for", async () => {
    write("src/app.ts", "const s = process.env.MY_APP_SECRET;\n");
    commit("code");
    const { blanks } = await scanProject(repo);
    expect(blanks).toEqual([{ name: "MY_APP_SECRET", hint: "Read in src/app.ts", source: "your code" }]);
  });

  it("leaves out test files, runtime names, names the code sets itself and plain flags", async () => {
    write("src/app.test.ts", "const k = process.env.TEST_ONLY_KEY;\n");
    write("src/app.ts", "process.env.SELF_SET_KEY = 'x';\nconst p = process.env.PORT;\nconst c = process.env.CI;\nconst f = process.env.FEATURE_FLAG;\n");
    commit("code");
    const { blanks } = await scanProject(repo);
    expect(blanks).toEqual([]);
  });

  it("takes a name once, however many files read it", async () => {
    write("src/a.ts", "const s = process.env.STRIPE_API_KEY;\n");
    write("src/b.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    const { blanks } = await scanProject(repo);
    expect(blanks).toHaveLength(1);
    expect(blanks[0]?.hint).toMatch(/read in src\/a\.ts\)$/);
  });

  it("takes the names a .env.example lists, with a hint only where a provider is known", async () => {
    write(".env.example", "STRIPE_API_KEY=\nDATABASE_URL=\nMY_OWN_FLAG=\nOTHER_KEY=\n");
    commit("template");
    const { blanks } = await scanProject(repo);
    const byName = new Map(blanks.map((b) => [b.name, b]));
    expect(byName.get("STRIPE_API_KEY")).toMatchObject({ source: ".env.example" });
    expect(byName.get("STRIPE_API_KEY")?.hint).toMatch(/^Stripe /);
    expect(byName.get("DATABASE_URL")?.hint).toMatch(/^Your database's /);
    expect(byName.get("MY_OWN_FLAG")?.hint).toBeUndefined();
    expect(byName.get("OTHER_KEY")?.hint).toBeUndefined();
    expect(byName.get("OTHER_KEY")?.source).toBe(".env.example");
  });

  it("keeps the code's blank when the template lists the same name", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    write(".env.example", "STRIPE_API_KEY=\n");
    commit("both");
    const { blanks } = await scanProject(repo);
    expect(blanks).toHaveLength(1);
    expect(blanks[0]?.source).toBe("your code");
  });

  it("caps the blanks at 25", async () => {
    const names = Array.from({ length: 30 }, (_, i) => `NAME_${i}_KEY`);
    write("src/app.ts", names.map((n) => `const v = process.env.${n};`).join("\n"));
    commit("many");
    const { blanks } = await scanProject(repo);
    expect(blanks).toHaveLength(25);
  });

  it("finds the webhook routes the project serves", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    write("app/api/github/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    commit("routes");
    const { hooks } = await scanProject(repo);
    expect(hooks.map((h) => h.target).sort()).toEqual(["/api/github/webhook", "/api/stripe/webhook"]);
    expect(hooks.find((h) => h.target === "/api/stripe/webhook")?.name).toBe("stripe");
  });

  it("skips a file too big to read", async () => {
    write("src/big.ts", `const s = process.env.STRIPE_API_KEY;\n${"x".repeat(200_001)}`);
    commit("big");
    const { blanks } = await scanProject(repo);
    expect(blanks).toEqual([]);
  });

  it("reads past a source file it can't open", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    fs.symlinkSync(path.join(repo, "gone.ts"), path.join(repo, "src/broken.ts"));
    commit("code");
    expect((await scanProject(repo)).blanks.map((b) => b.name)).toEqual(["STRIPE_API_KEY"]);
  });

  it("finds nothing in a folder that isn't there", async () => {
    const { blanks, hooks } = await scanProject(path.join(repo, "nope"));
    expect(blanks).toEqual([]);
    expect(hooks).toEqual([]);
  });
});

describe("intakeProject", () => {
  it("adds a 🪝 blank for a route it finds and tells the vault about its blanks", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("routes");
    shell.mockResolvedValue({ imported: [{ file: ".env.local", name: "RESEND_API_KEY" }], blanked: ["STRIPE_API_KEY"], tracked: [], keys: ["blank\nSTRIPE_API_KEY"] } satisfies VaultIntake);
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.importedFrom).toEqual([".env.local"]);
    expect(result.blanks).toBe(1);
    // The screen's lists: names, files, hints and routes.
    expect(result.details?.imported).toEqual([{ name: "RESEND_API_KEY", file: ".env.local" }]);
    expect(result.details?.blanks.map((b) => [b.name, b.source])).toEqual([["STRIPE_API_KEY", "your code"]]);
    expect(result.details?.hooks.map((h) => [h.name, h.target])).toEqual([["stripe", "/api/stripe/webhook"]]);
    expect(listWebhooks([repo]).map((h) => [h.name, h.target])).toEqual([["stripe", "http://localhost:3000/api/stripe/webhook"]]);
    expect(shell).toHaveBeenCalledWith("/secrets/intake", expect.objectContaining({ folder: repo }));
  });

  it("skips a route whose target the folder already has, whatever its name", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    commit("routes");
    addWebhook({ folder: repo, name: "payments", target: "/api/stripe/webhook" });
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(0);
  });

  it("gives a second route from the same provider its path's segment", async () => {
    write("app/api/aaa/webhook/route.ts", "const s = 'stripe-signature';\n");
    write("app/api/bbb/webhook/route.ts", "const s = 'stripe-signature';\n");
    commit("routes");
    await intakeProject(repo);
    expect(listWebhooks([repo]).map((h) => h.name).sort()).toEqual(["stripe", "stripe-bbb"]);
  });

  it("skips a route whose name the folder already has under that segment too", async () => {
    write("app/api/bbb/webhook/route.ts", "const s = 'stripe-signature';\n");
    commit("routes");
    addWebhook({ folder: repo, name: "stripe", target: "/api/one" });
    addWebhook({ folder: repo, name: "stripe-bbb", target: "/api/two" });
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(0);
    expect(listWebhooks([repo])).toHaveLength(2);
  });

  it("names a route with no segment of its own", async () => {
    write("app/api/webhook/route.ts", "export async function POST(r) { stripe.webhooks.constructEvent(await r.text(), sig, s); }\n");
    commit("routes");
    addWebhook({ folder: repo, name: "stripe", target: "/api/elsewhere" });
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(1);
    expect(listWebhooks([repo]).map((h) => h.name).sort()).toEqual(["stripe", "stripe-route"]);
  });

  it("skips a route the store refuses to take", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    commit("routes");
    const webhooks = await import("./webhooks");
    const spy = vi.spyOn(webhooks, "addWebhook").mockImplementation(() => {
      throw new Error("no");
    });
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(0);
    spy.mockRestore();
  });

  it("remembers what it offered, so a removed blank doesn't come back", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    shell.mockResolvedValue({ imported: [], blanked: ["STRIPE_API_KEY"], tracked: [], keys: ["blank\nSTRIPE_API_KEY"] } satisfies VaultIntake);
    await intakeProject(repo);
    const offered = JSON.parse(fs.readFileSync(path.join(data, "intake.json"), "utf8")) as { offered: Record<string, string[]> };
    expect(offered.offered[repo]).toEqual(["blank\nSTRIPE_API_KEY"]);

    // The user deletes the blank; a new commit starts another intake, which must not re-offer it.
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\nconst t = process.env.OPENAI_API_KEY;\n");
    commit("more");
    await intakeProject(repo);
    expect(shell).toHaveBeenLastCalledWith("/secrets/intake", expect.objectContaining({ skip: ["blank\nSTRIPE_API_KEY"] }));
  });

  it("remembers a route it offered, so a deleted one doesn't come back", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    commit("routes");
    await intakeProject(repo);
    const offered = JSON.parse(fs.readFileSync(path.join(data, "intake.json"), "utf8")) as { offered: Record<string, string[]> };
    expect(offered.offered[repo]).toEqual(["hook\n/api/stripe/webhook"]);
  });

  it("says nothing happened when neither HEAD nor an .env file changed", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    await intakeProject(repo);
    const calls = shell.mock.calls.length;
    expect(await intakeProject(repo)).toEqual({ imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] });
    expect(shell.mock.calls.length).toBe(calls);
  });

  it("settles its stamp when an .env file is a broken link", async () => {
    fs.symlinkSync(path.join(repo, "gone"), path.join(repo, ".env.local"));
    await intakeProject(repo);
    const calls = shell.mock.calls.length;
    await intakeProject(repo);
    expect(shell.mock.calls.length).toBe(calls);
  });

  it("looks again when an .env file changes", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    await intakeProject(repo);
    const calls = shell.mock.calls.length;
    fs.writeFileSync(path.join(repo, ".env.local"), "A=1\n");
    await intakeProject(repo);
    expect(shell.mock.calls.length).toBe(calls + 1);
  });

  it("looks again when a commit lands", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    await intakeProject(repo);
    const calls = shell.mock.calls.length;
    commit("more");
    await intakeProject(repo);
    expect(shell.mock.calls.length).toBe(calls + 1);
  });

  it("shares one run between callers", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    const [a, b] = await Promise.all([intakeProject(repo), intakeProject(repo)]);
    expect(a).toBe(b);
    expect(shell).toHaveBeenCalledTimes(1);
  });

  it("takes in what it can when the folder is gone", async () => {
    const result = await intakeProject(path.join(repo, "nope"));
    expect(result).toEqual({ imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] });
  });

  it("takes in the webhooks alone when the vault isn't there", async () => {
    write("app/api/stripe/webhook/route.ts", "export async function POST() { return new Response('ok'); }\n");
    commit("routes");
    shell.mockRejectedValue(new Error("The browser pane only exists in the desktop app."));
    const result = await intakeProject(repo);
    expect(result.hooks).toBe(1);
    expect(result.imported).toBe(0);
    expect(listWebhooks([repo])).toHaveLength(1);
  });

  it("counts the tracked .env files the vault holds values for", async () => {
    write("src/app.ts", "const s = process.env.STRIPE_API_KEY;\n");
    commit("code");
    shell.mockResolvedValue({ imported: [], blanked: [], tracked: [".env", ".env.local"], keys: [] } satisfies VaultIntake);
    const result = await intakeProject(repo);
    expect(result.tracked).toEqual([".env", ".env.local"]);
  });
});

describe("intakeText", () => {
  it("says what happened, in the singular and the plural", () => {
    expect(
      intakeText({ imported: 1, importedFrom: [".env.local"], blanks: 2, hooks: 1, tracked: [".env"] }),
    ).toBe(
      "Moved 1 secret from .env.local into 🔐; added 2 blanks to 🔐 for keys your code reads; found 1 webhook for 🪝; .env is committed to git, so rotate those keys at the provider.",
    );
    expect(
      intakeText({ imported: 2, importedFrom: [".env.local", ".env.production"], blanks: 1, hooks: 3, tracked: [".env", ".env.local"] }),
    ).toBe(
      "Moved 2 secrets from .env.local, .env.production into 🔐; added 1 blank to 🔐 for keys your code reads; found 3 webhooks for 🪝; .env, .env.local are committed to git, so rotate those keys at the provider.",
    );
  });

  it("says nothing when nothing happened", () => {
    expect(intakeText({ imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] })).toBeNull();
  });
});
