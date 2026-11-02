// Weft's Puku trial in the runner: a puku thread with no Puku login of its own runs on the trial (queryOptions),
// and a failed sign-in tries a fresh trial token before opening Puku's login. Same harness as lib/runner.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendEnv } from "./puku-idle";
import { flush, makeCard, nth, resetHarness } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./puku-trial", async () => (await import("./runner.harness")).pukuTrialMock(h));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("Puku trial", () => {
  it("starts a puku thread on Weft's Puku trial when it has one", async () => {
    h.trialOptions = { env: { PUKU_AI_BASE_URL: "https://weft.example/api/puku" }, settings: { apiKeyHelper: "/bin/cat 'tok'" } };
    addCard({ id: "c1", backend: "puku" });
    addCard({ id: "c2" });
    const q = await send("c1");
    expect(q.options.env).toEqual({ PATH: "/usr/bin", ...backendEnv("puku", {}), PUKU_AI_BASE_URL: "https://weft.example/api/puku" });
    expect(q.options.settings).toEqual({ apiKeyHelper: "/bin/cat 'tok'" });
    // Only puku threads use it.
    const other = await send("c2");
    expect(other.options.env).toEqual({ PATH: "/usr/bin" });
    expect(other.options.settings).toBeUndefined();
  });

  it("starts a puku thread with no trial token as it always did", async () => {
    addCard({ id: "c1", backend: "puku" });
    const q = await send("c1");
    expect(q.options.env).toEqual({ PATH: "/usr/bin", ...backendEnv("puku", {}) });
    expect(q.options.settings).toBeUndefined();
  });

});

describe("a puku thread with no Puku login", () => {
    const NOT_IN = "Invalid API key · Fix external API key";

    async function pukuFails() {
      addCard({ id: "c1", backend: "puku" });
      const q = await send("c1", "please");
      q.fail(new Error(NOT_IN));
      await flush();
    }

    it("retries on a fresh Weft trial token without opening a login", async () => {
      await pukuFails();
      expect(h.fetchedTrials).toBe(1);
      expect(h.startLogin).toEqual([]);
      expect(h.queries).toHaveLength(2);
      // A new CLI process, so its first message carries the puku context again (lib/puku-context.ts).
      expect(lastQuery().received).toEqual([expect.stringMatching(/^<system-reminder>[\s\S]*<\/system-reminder>\n\nplease$/)]);
    });

    it("opens Puku's login and says why when the trial isn't available", async () => {
      h.trialResult = { ok: false, reason: "signed-out", message: "Sign in to your Weft account to try Puku free." };
      await pukuFails();
      expect(h.startLogin).toEqual([expect.objectContaining({ backend: "puku" })]);
      expect(h.noteTrial).toEqual([{ backend: "puku", trial: { reason: "signed-out", message: "Sign in to your Weft account to try Puku free." } }]);
    });

    it("opens the login without asking again when a token was just fetched", async () => {
      h.trialJustFetched = true;
      await pukuFails();
      expect(h.fetchedTrials).toBe(0);
      expect(h.startLogin).toHaveLength(1);
      expect(h.noteTrial[0]).toMatchObject({ backend: "puku", trial: { reason: "failed", message: expect.stringContaining(NOT_IN) as string } });
    });

    it("skips the trial when puku has a login of its own", async () => {
      h.ownPukuLogin = true;
      await pukuFails();
      expect(h.fetchedTrials).toBe(0);
      expect(h.startLogin).toHaveLength(1);
      expect(h.noteTrial).toEqual([]);
    });

    it("keeps the error on the card when the login can't start", async () => {
      h.ownPukuLogin = true;
      h.loginFails = true;
      await pukuFails();
      expect(card("c1").error).toContain("isn't on this app's PATH");
      expect(h.noteTrial).toEqual([]);
    });

    it("retryPukuWithTrial runs waiting threads on the trial once you sign in to Weft", async () => {
      h.trialResult = { ok: false, reason: "signed-out", message: "Sign in" };
      await pukuFails();
      expect(h.queries).toHaveLength(1);
      h.trialResult = { ok: true };
      await runner.retryPukuWithTrial();
      await flush();
      expect(h.cancelLogin).toEqual(["puku"]);
      expect(h.queries).toHaveLength(2);
    });

    it("retryPukuWithTrial does nothing without waiters, with a login of its own, or when the trial fails", async () => {
      await runner.retryPukuWithTrial();
      expect(h.fetchedTrials).toBe(0);
      h.trialResult = { ok: false, reason: "signed-out", message: "Sign in" };
      await pukuFails();
      const fetched = h.fetchedTrials;
      await runner.retryPukuWithTrial();
      expect(h.fetchedTrials).toBe(fetched + 1);
      expect(h.cancelLogin).toEqual([]);
      h.ownPukuLogin = true;
      await runner.retryPukuWithTrial();
      expect(h.fetchedTrials).toBe(fetched + 1);
    });
  });

