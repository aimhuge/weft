import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gog CLI's odd corners, which the happy-path files (lib/gog.test.ts, lib/gog-signin.test.ts)
// don't reach: a credentials list whose entries aren't all named, and a sign-in that starts while
// another one is still choosing its OAuth client.
// The fake CLI and the shared helpers live in lib/gog.harness.ts.
const cp = await vi.hoisted(async () => (await import("./gog.harness")).cpState());

vi.mock("node:child_process", async () => (await import("./gog.harness")).childProcessMock(cp));
vi.mock("./env", async () => (await import("./gog.harness")).envMock());

const { child, gogState, hasClient, holds, loadGog, says } = await import("./gog.harness");

let gog: typeof import("./gog");

beforeEach(async () => {
  vi.useFakeTimers();
  gog = await loadGog(cp);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the stored OAuth clients", () => {
  it("keeps the clients gog named, and skips the entries with no name in them", async () => {
    says(cp, "--version", "v0.47.0");
    // gog's list holds an entry without a client name: it isn't a client, so it isn't kept.
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "mine" }, { client: 7 }, {}] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: true });
  });

  it("has no clients at all when gog lists none", async () => {
    says(cp, "--version", "v0.47.0");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: 7 }] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: false });
  });
});

describe("a sign-in that starts while another one runs", () => {
  it("refuses a sign-in that starts while the first one's client is still being chosen", async () => {
    // A sign-in that is still choosing its OAuth client hasn't opened a browser yet, but it is on
    // its way. So the first sign-in's credentials lookup answers slowly, and a second sign-in
    // starts meanwhile: it passes the "already signing in" check (the first one hasn't opened its
    // browser yet) and opens one. The first sign-in then finds the second one under way when it
    // comes back from the lookup, and gives up instead of opening a second browser.
    const release = holds(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "mine" }] }));

    // The first sign-in starts and waits for its client.
    const first = gog.addGogAccount("me@example.com");
    await vi.waitFor(() => expect(cp.execFile).toHaveBeenCalled());

    // The second sign-in gets its client and opens its browser.
    await gog.addGogAccount("you@example.com");
    expect(gogState().adding?.email).toBe("you@example.com");
    expect(cp.spawn).toHaveBeenCalledTimes(1);

    release();
    // The first sign-in finds the second one under way and gives up.
    await expect(first).rejects.toThrow("Already signing in you@example.com");
    // Only one browser was opened, for the sign-in that won.
    expect(cp.spawn).toHaveBeenCalledTimes(1);
    expect(cp.spawn.mock.calls[0]![1]).toEqual(["auth", "add", "you@example.com", "--client", "mine"]);
  });
});

describe("the sign-in's own output", () => {
  it("signs in through Weft's own client when the credentials lookup fails", async () => {
    // gog can't list the clients it has, so Weft's own client is used instead of the user's.
    cp.failures.set("auth credentials list --json", new Error("no credentials"));
    vi.stubEnv("WEFT_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    vi.stubEnv("WEFT_GOOGLE_CLIENT_SECRET", "shh");

    await gog.addGogAccount("me@example.com");
    // Weft's client is stored in gog first, then the sign-in names it.
    expect(cp.stdin.at(-1)).toContain("abc.apps.googleusercontent.com");
    expect(cp.spawn.mock.calls[0]![1]).toEqual(["auth", "add", "me@example.com", "--client", "weft"]);
  });

  it("keeps the last line of what gog said as the error", async () => {
    hasClient(cp, "mine");
    await gog.addGogAccount("me@example.com");
    child(cp).stdout.emit("data", Buffer.from("first line\nlast line\n"));
    child(cp).emit("close", 1, null);
    expect(gogState().lastError).toBe("last line");
  });

  it("has no error to show when gog said nothing at all", async () => {
    hasClient(cp, "mine");
    await gog.addGogAccount("me@example.com");
    child(cp).emit("close", 1, null);
    expect(gogState().lastError).toBe("gog auth add exited with 1");
  });
});
