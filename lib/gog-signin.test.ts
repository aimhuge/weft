import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The browser sign-in behind Settings → Connectors → Google Workspace: gog opens Google's consent
// page and waits for the redirect, so a sign-in can be under way, cancelled or fail. The fake CLI and
// the shared helpers live in lib/gog.harness.ts.
const cp = await vi.hoisted(async () => (await import("./gog.harness")).cpState());

vi.mock("node:child_process", async () => (await import("./gog.harness")).childProcessMock(cp));
vi.mock("./env", async () => (await import("./gog.harness")).envMock());

const { child, gogState, hasClient, loadGog, says } = await import("./gog.harness");

let gog: typeof import("./gog");

beforeEach(async () => {
  vi.useFakeTimers();
  gog = await loadGog(cp);
  // A sign-in goes through an OAuth client; by default the user's own one is stored.
  hasClient(cp, "mine");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("addGogAccount", () => {
  it("refuses an email that isn't one", async () => {
    await expect(gog.addGogAccount("not-an-email")).rejects.toThrow("Enter the Google account's email.");
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("refuses a second sign-in while one is under way", async () => {
    await gog.addGogAccount("me@example.com");
    await expect(gog.addGogAccount("you@example.com")).rejects.toThrow("Already signing in me@example.com");
    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });

  it("spawns gog with the account, the client and the readonly flag", async () => {
    await gog.addGogAccount("me@example.com", { readonly: true });
    expect(cp.spawn).toHaveBeenCalledWith("/usr/local/bin/gog", ["auth", "add", "me@example.com", "--client", "mine", "--readonly"], {
      env: { PATH: "/usr/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("spawns gog without the readonly flag by default", async () => {
    await gog.addGogAccount("me@example.com");
    expect(cp.spawn.mock.calls[0]![1]).toEqual(["auth", "add", "me@example.com", "--client", "mine"]);
  });

  it("signs in through Weft's own client when the user has none", async () => {
    hasClient(cp, "weft");
    vi.stubEnv("WEFT_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    vi.stubEnv("WEFT_GOOGLE_CLIENT_SECRET", "shh");

    await gog.addGogAccount("me@example.com");
    // Weft's client is stored in gog first, then the sign-in names it.
    expect(cp.stdin.at(-1)).toContain("abc.apps.googleusercontent.com");
    expect(cp.spawn.mock.calls[0]![1]).toEqual(["auth", "add", "me@example.com", "--client", "weft"]);
  });

  it("refuses to sign in when there is no client at all", async () => {
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [] }));
    await expect(gog.addGogAccount("me@example.com")).rejects.toThrow("Choose an OAuth client JSON first.");
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("clears the sign-in when gog exits cleanly", async () => {
    await gog.addGogAccount("me@example.com");
    child(cp).emit("close", 0, null);
    expect(gogState().adding).toBeNull();
    expect(gogState().lastError).toBeNull();
  });

  it("keeps the last output line as the error when gog fails", async () => {
    await gog.addGogAccount("me@example.com");
    child(cp).stdout.emit("data", Buffer.from("opening browser\n"));
    child(cp).stderr.emit("data", Buffer.from("account not found\n"));
    child(cp).emit("close", 1, null);
    expect(gogState().adding).toBeNull();
    expect(gogState().lastError).toBe("account not found");
  });

  it("falls back to the exit code when gog says nothing", async () => {
    await gog.addGogAccount("me@example.com");
    child(cp).emit("close", 3, null);
    expect(gogState().lastError).toBe("gog auth add exited with 3");
  });

  it("records the error when the process can't start", async () => {
    await gog.addGogAccount("me@example.com");
    child(cp).emit("error", new Error("spawn ENOENT"));
    expect(gogState().adding).toBeNull();
    expect(gogState().lastError).toBe("spawn ENOENT");
  });

  it("kills the browser sign-in after the timeout", async () => {
    await gog.addGogAccount("me@example.com");
    expect(child(cp).kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(gog.ADD_TIMEOUT_MS);
    expect(child(cp).kill).toHaveBeenCalledTimes(1);
  });

  it("ignores a sign-in that another one has replaced", async () => {
    await gog.addGogAccount("me@example.com");
    const first = child(cp);
    first.emit("close", 0, null);
    expect(gogState().adding).toBeNull();

    await gog.addGogAccount("you@example.com");
    expect(gogState().adding?.email).toBe("you@example.com");

    // The first sign-in's process reports in late; it must not clear the second one's state.
    first.emit("close", 1, null);
    expect(gogState().adding?.email).toBe("you@example.com");
  });
});

describe("cancelGogAdd", () => {
  it("does nothing when no sign-in is under way", () => {
    gog.cancelGogAdd();
    expect(cp.spawn).not.toHaveBeenCalled();
    expect(gogState().lastError).toBeNull();
  });

  it("kills the sign-in and leaves no error behind", async () => {
    await gog.addGogAccount("me@example.com");
    gog.cancelGogAdd();
    expect(child(cp).kill).toHaveBeenCalledTimes(1);
    expect(gogState().lastError).toBeNull();
  });

  it("doesn't call a cancelled sign-in a failure", async () => {
    await gog.addGogAccount("me@example.com");
    gog.cancelGogAdd();
    child(cp).stdout.emit("data", Buffer.from("the user closed the browser\n"));
    child(cp).emit("close", 1, null);
    expect(gogState().adding).toBeNull();
    expect(gogState().lastError).toBeNull();
  });
});
