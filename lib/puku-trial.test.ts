import fs from "node:fs";
import nodeOs from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signTrialToken } from "./puku-trial-token";

// The desktop side of the Puku trial: own-login detection, the token file, fetching and refreshing, and following Weft sign-in.

const t = vi.hoisted(() => ({
  root: "",
  key: "anon-key",
  getSession: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = () => t.root + "/home";
  return { ...actual, default: { ...actual, homedir }, homedir };
});
vi.mock("./store", () => ({ get DATA_DIR() { return t.root + "/data"; } }));
vi.mock("./account", () => ({
  get SUPABASE_KEY() { return t.key; },
  accountClient: () => ({ auth: { getSession: t.getSession } }),
}));

type Trial = typeof import("./puku-trial");
let trial: Trial;
let bus: typeof import("./bus");
const g = globalThis as Record<string, unknown>;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const NOW = Date.parse("2026-10-13T12:00:00Z");

const signedIn = () => t.getSession.mockResolvedValue({ data: { session: { access_token: "acc" } } });
const signedOut = () => t.getSession.mockResolvedValue({ data: { session: null } });
const answer = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};
const tokenFile = () => trial.TOKEN_FILE;
async function goodToken(exp = Date.now() + 86_400_000) {
  const { token } = await signTrialToken("u1", "s", exp - 86_400_000);
  return { token, exp };
}

beforeEach(async () => {
  t.root = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "weft-puku-"));
  t.key = "anon-key";
  t.getSession.mockReset();
  signedIn();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PUKU_AI_API_KEY", "");
  vi.stubEnv("PUKU_CLI_OAUTH_TOKEN", "");
  delete g.__weftPukuTrial;
  vi.resetModules();
  trial = await import("./puku-trial");
  bus = await import("./bus");
});

afterEach(() => {
  (g.__weftPukuTrial as { unsubscribe?: () => void; timer?: NodeJS.Timeout } | undefined)?.unsubscribe?.();
  clearTimeout((g.__weftPukuTrial as { timer?: NodeJS.Timeout } | undefined)?.timer);
  delete g.__weftPukuTrial;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(t.root, { recursive: true, force: true });
});

describe("hasOwnPukuLogin", () => {
  it("is false with nothing", () => expect(trial.hasOwnPukuLogin()).toBe(false));

  it("sees a key or OAuth token in the env", () => {
    expect(trial.hasOwnPukuLogin({ ...process.env, PUKU_AI_API_KEY: "k" })).toBe(true);
    expect(trial.hasOwnPukuLogin({ ...process.env, PUKU_CLI_OAUTH_TOKEN: "k" })).toBe(true);
  });

  it("reads the process env by default", () => {
    vi.stubEnv("PUKU_AI_API_KEY", "k");
    expect(trial.hasOwnPukuLogin()).toBe(true);
  });

  it("sees puku-cli's session file", () => {
    writeJson(trial.PUKU_SESSION, { accessToken: "a" });
    expect(trial.hasOwnPukuLogin()).toBe(true);
  });

  it("ignores an empty session token or bad JSON", () => {
    writeJson(trial.PUKU_SESSION, { accessToken: "" });
    expect(trial.hasOwnPukuLogin()).toBe(false);
    writeJson(trial.PUKU_SESSION, "{nope");
    expect(trial.hasOwnPukuLogin()).toBe(false);
  });

  it("sees an apiKeyHelper in puku's settings", () => {
    writeJson(trial.PUKU_SETTINGS, { apiKeyHelper: "cat x" });
    expect(trial.hasOwnPukuLogin()).toBe(true);
    writeJson(trial.PUKU_SETTINGS, { apiKeyHelper: "" });
    expect(trial.hasOwnPukuLogin()).toBe(false);
    writeJson(trial.PUKU_SETTINGS, "[");
    expect(trial.hasOwnPukuLogin()).toBe(false);
  });
});

describe("currentTrialToken and trialOptions", () => {
  it("is null without a file or with garbage", () => {
    expect(trial.currentTrialToken()).toBeNull();
    writeJson(tokenFile(), "junk");
    expect(trial.currentTrialToken()).toBeNull();
    expect(trial.trialOptions()).toBeNull();
  });

  it("is null within a minute of expiry, the token when good", async () => {
    const soon = await goodToken(NOW + 30_000);
    writeJson(tokenFile(), `${soon.token}\n`);
    expect(trial.currentTrialToken(NOW)).toBeNull();
    const fine = await goodToken(NOW + 3_600_000);
    writeJson(tokenFile(), `${fine.token}\n`);
    expect(trial.currentTrialToken(NOW)).toBe(fine.token);
  });

  it("gives a thread the base URL, helper TTL and a cat helper", async () => {
    writeJson(tokenFile(), (await goodToken()).token);
    const opts = trial.trialOptions(NOW, "darwin");
    expect(opts?.env).toEqual({ PUKU_AI_BASE_URL: trial.TRIAL_URL, PUKU_CLI_API_KEY_HELPER_TTL_MS: String(trial.HELPER_TTL_MS) });
    expect(opts?.settings.apiKeyHelper).toBe(`/bin/cat '${tokenFile()}'`);
  });

  it("quotes a single quote in the path", async () => {
    t.root = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "weft-puku-q'"));
    vi.resetModules();
    trial = await import("./puku-trial");
    writeJson(tokenFile(), (await goodToken()).token);
    expect(trial.trialOptions(NOW, "darwin")?.settings.apiKeyHelper).toContain("'\\''");
  });

  it("reads the trial file through PowerShell on Windows", async () => {
    writeJson(tokenFile(), (await goodToken()).token);
    const helper = trial.trialOptions(NOW, "win32")?.settings.apiKeyHelper;
    expect(helper).toMatch(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand /);
    const script = Buffer.from(helper!.split(" ").at(-1)!, "base64").toString("utf16le");
    expect(script).toContain(`[IO.File]::ReadAllText('${tokenFile().replace(/'/g, "''")}')`);
  });

  it("steps aside for a Puku login of your own", async () => {
    writeJson(tokenFile(), (await goodToken()).token);
    vi.stubEnv("PUKU_AI_API_KEY", "mine");
    expect(trial.trialOptions()).toBeNull();
  });
});

describe("fetchTrialToken", () => {
  const ok = async () => {
    const { token, exp } = await goodToken();
    answer({ token, expiresAt: exp });
    return { token, exp };
  };

  it("says signed-out without a session or without a Supabase key", async () => {
    signedOut();
    expect(await trial.fetchTrialToken()).toMatchObject({ ok: false, reason: "signed-out" });
    t.key = "";
    expect(await trial.fetchTrialToken()).toMatchObject({ ok: false, reason: "signed-out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says unavailable when the trial can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await trial.fetchTrialToken()).toEqual({ ok: false, reason: "unavailable", message: "Couldn't reach Weft's Puku trial: offline" });
  });

  it("maps a 401 to signed-out, with the server's words when it gave some", async () => {
    answer({ error: "expired" }, 401);
    expect(await trial.fetchTrialToken()).toEqual({ ok: false, reason: "signed-out", message: "expired" });
    fetchMock.mockResolvedValue(new Response("not json", { status: 401 }));
    expect(await trial.fetchTrialToken()).toEqual({ ok: false, reason: "signed-out", message: "Sign in to your Weft account again." });
  });

  it("maps other failures to unavailable", async () => {
    answer({ error: "nope" }, 503);
    expect(await trial.fetchTrialToken()).toEqual({ ok: false, reason: "unavailable", message: "nope" });
    answer({}, 500);
    expect(await trial.fetchTrialToken()).toMatchObject({ reason: "unavailable", message: "Weft's Puku trial answered 500." });
    answer({ token: 1, expiresAt: "x" });
    expect(await trial.fetchTrialToken()).toMatchObject({ reason: "unavailable", message: "Weft's Puku trial answered 200." });
    fetchMock.mockResolvedValue(new Response("garbage", { status: 200 }));
    expect(await trial.fetchTrialToken()).toMatchObject({ reason: "unavailable" });
  });

  it("writes a 0600 token file, posts the bearer and notes when it fetched", async () => {
    const { token } = await ok();
    expect(trial.trialJustFetched()).toBe(false);
    expect(await trial.fetchTrialToken()).toEqual({ ok: true });
    expect(fs.readFileSync(tokenFile(), "utf8")).toBe(token);
    if (process.platform !== "win32") expect(fs.statSync(tokenFile()).mode & 0o777).toBe(0o600);
    expect(fetchMock).toHaveBeenCalledWith(`${trial.TRIAL_URL}/trial-token`, { method: "POST", headers: { authorization: "Bearer acc" } });
    expect(trial.trialJustFetched()).toBe(true);
    expect(trial.trialJustFetched(Date.now() + trial.RETRY_WINDOW_MS + 1)).toBe(false);
  });

  it("shares one request between concurrent calls", async () => {
    await ok();
    const [a, b] = await Promise.all([trial.fetchTrialToken(), trial.fetchTrialToken()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await trial.fetchTrialToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns a thrown error inside into unavailable", async () => {
    t.getSession.mockRejectedValue(new Error("keychain locked"));
    expect(await trial.fetchTrialToken()).toEqual({ ok: false, reason: "unavailable", message: "keychain locked" });
  });

  it("refreshes before the token expires", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const exp = NOW + 24 * 3_600_000;
    answer({ token: (await signTrialToken("u1", "s", NOW)).token, expiresAt: exp });
    await trial.fetchTrialToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(exp - trial.REFRESH_BEFORE_MS - NOW - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("forgetTrialToken", () => {
  it("removes the file, the timer and the fetched mark", async () => {
    const { token, exp } = await goodToken();
    answer({ token, expiresAt: exp });
    await trial.fetchTrialToken();
    trial.forgetTrialToken();
    expect(fs.existsSync(tokenFile())).toBe(false);
    expect(trial.trialJustFetched()).toBe(false);
    trial.forgetTrialToken();
  });
});

describe("startPukuTrial", () => {
  const settle = () => new Promise((r) => setTimeout(r, 5));

  it("schedules from an existing token file, once", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { token } = await goodToken(NOW + 3 * 3_600_000);
    writeJson(tokenFile(), token);
    answer({});
    trial.startPukuTrial(() => {}, NOW);
    trial.startPukuTrial(() => {}, NOW);
    await vi.advanceTimersByTimeAsync(3_600_000 - 1);
    expect(t.getSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.getSession).toHaveBeenCalledTimes(1);
  });

  it("starts without a token file, and with the clock as now", () => {
    trial.startPukuTrial(() => {});
    expect(fs.existsSync(tokenFile())).toBe(false);
  });

  it("calls onSignIn on an account event while signed in", async () => {
    const onSignIn = vi.fn();
    trial.startPukuTrial(onSignIn);
    bus.publish({ type: "account" });
    await settle();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("ignores other events and forgets the token on sign-out", async () => {
    const onSignIn = vi.fn();
    writeJson(tokenFile(), "x");
    trial.startPukuTrial(onSignIn);
    bus.publish({ type: "cards" } as never);
    await settle();
    expect(fs.existsSync(tokenFile())).toBe(true);
    signedOut();
    bus.publish({ type: "account" });
    await settle();
    expect(onSignIn).not.toHaveBeenCalled();
    expect(fs.existsSync(tokenFile())).toBe(false);
  });

  it("swallows an error reading the session", async () => {
    t.getSession.mockRejectedValue(new Error("boom"));
    const onSignIn = vi.fn();
    trial.startPukuTrial(onSignIn);
    bus.publish({ type: "account" });
    await settle();
    expect(onSignIn).not.toHaveBeenCalled();
  });
});
