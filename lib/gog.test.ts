import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gog CLI behind Settings → Connectors: its version, its OAuth client and the accounts signed in.
// The fake CLI and the shared helpers live in lib/gog.harness.ts; the browser sign-in has its own file
// (lib/gog-signin.test.ts).
const cp = await vi.hoisted(async () => (await import("./gog.harness")).cpState());

vi.mock("node:child_process", async () => (await import("./gog.harness")).childProcessMock(cp));
vi.mock("./env", async () => (await import("./gog.harness")).envMock());

const { child, loadGog, says } = await import("./gog.harness");

let gog: typeof import("./gog");

beforeEach(async () => {
  vi.useFakeTimers();
  gog = await loadGog(cp);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseVersion", () => {
  it("pulls the version out of gog's banner", () => {
    expect(gog.parseVersion("v0.47.0 (f7dab31f abc)")).toBe("0.47.0");
    expect(gog.parseVersion("0.12.0 (Homebrew)")).toBe("0.12.0");
  });

  it("falls back to the trimmed text when there's no version", () => {
    expect(gog.parseVersion("  gog unknown  ")).toBe("gog unknown");
    expect(gog.parseVersion("")).toBe("");
  });
});

describe("olderThan", () => {
  it("compares the three parts of the version", () => {
    expect(gog.olderThan("0.46.0", "0.47.0")).toBe(true);
    expect(gog.olderThan("0.47.1", "0.47.0")).toBe(false);
    expect(gog.olderThan("1.0.0", "0.47.0")).toBe(false);
    expect(gog.olderThan("0.46.9", "0.47.0")).toBe(true);
    expect(gog.olderThan("0.47.0", "0.47.0")).toBe(false);
  });

  it("treats a missing part as zero", () => {
    expect(gog.olderThan("0.47", "0.47.0")).toBe(false);
    expect(gog.olderThan("0.46", "0.47.0")).toBe(true);
    expect(gog.olderThan("0.47.0", "0.47")).toBe(false);
    expect(gog.olderThan("0.48.0", "0.47")).toBe(false);
    expect(gog.olderThan("0.46.0", "0.47")).toBe(true);
  });

  it("compares a missing part as zero when the versions differ", () => {
    expect(gog.olderThan("0.47", "0.47.1")).toBe(true);
    expect(gog.olderThan("0.47.1", "0.47")).toBe(false);
    expect(gog.olderThan("0.47.1", "0.47.0")).toBe(false);
  });
});

describe("parseAccounts", () => {
  it("reads the email out of each stored token key", () => {
    expect(gog.parseAccounts(JSON.stringify({ keys: ["token:default:me@example.com", "token:other:you@example.com"] }))).toEqual([
      { client: "default", email: "me@example.com" },
      { client: "other", email: "you@example.com" },
    ]);
  });

  it("skips the keys that aren't tokens", () => {
    expect(gog.parseAccounts(JSON.stringify({ keys: ["token:default:me@example.com", "not-a-token", 42, "token:noemail"] }))).toEqual([
      { client: "default", email: "me@example.com" },
    ]);
  });

  it("returns an empty list when there are no accounts", () => {
    expect(gog.parseAccounts("{}")).toEqual([]);
    expect(gog.parseAccounts(JSON.stringify({ keys: [] }))).toEqual([]);
    expect(gog.parseAccounts(JSON.stringify({ keys: ["nope"] }))).toEqual([]);
  });
});

describe("checkClientJson", () => {
  it("accepts an installed or web OAuth client", () => {
    expect(() => gog.checkClientJson(JSON.stringify({ installed: { client_id: "abc.apps.googleusercontent.com" } }))).not.toThrow();
    expect(() => gog.checkClientJson(JSON.stringify({ web: { client_id: "abc.apps.googleusercontent.com" } }))).not.toThrow();
  });

  it("refuses text that isn't JSON", () => {
    expect(() => gog.checkClientJson("not json")).toThrow("That file isn't JSON.");
  });

  it("refuses JSON that isn't an OAuth client", () => {
    expect(() => gog.checkClientJson("null")).toThrow("That JSON isn't an OAuth client");
    expect(() => gog.checkClientJson("{}")).toThrow("That JSON isn't an OAuth client");
    expect(() => gog.checkClientJson(JSON.stringify({ installed: {} }))).toThrow("That JSON isn't an OAuth client");
    expect(() => gog.checkClientJson(JSON.stringify({ installed: { client_id: 7 } }))).toThrow("That JSON isn't an OAuth client");
  });
});

describe("gogPath", () => {
  it("finds gog on the PATH", () => {
    expect(gog.gogPath()).toBe("/usr/local/bin/gog");
    expect(cp.which).toHaveBeenCalledWith("/usr/bin/which", ["gog"]);
  });

  it("returns null when gog isn't there", () => {
    cp.which.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(gog.gogPath()).toBeNull();
  });

  it("returns null when the path is blank", () => {
    cp.which.mockReturnValue("  \n");
    expect(gog.gogPath()).toBeNull();
  });
});

describe("gogStatus", () => {
  it("says gog isn't installed when it isn't on the PATH", async () => {
    cp.which.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(await gog.gogStatus()).toEqual({ installed: false });
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it("reports the version, accounts and credentials of the bundled gog", async () => {
    cp.which.mockReturnValue("/Applications/Weft.app/Contents/toolchain/bin/gog\n");
    says(cp, "--version", "gog version v0.47.0 (f7dab31f)\n");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "mine" }] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: ["token:default:me@example.com"] }));

    expect(await gog.gogStatus()).toEqual({
      installed: true,
      version: "0.47.0",
      bundled: true,
      outdated: false,
      ownClient: true,
      weftClient: false,
      accounts: [{ client: "default", email: "me@example.com" }],
      adding: null,
      lastError: null,
    });
  });

  it("reports a user's own gog as not bundled and an old one as outdated", async () => {
    says(cp, "--version", "gog version v0.40.0\n");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({
      installed: true,
      bundled: false,
      outdated: true,
      ownClient: false,
      accounts: [],
    });
  });

  it("counts Weft's own client as no user client of their own", async () => {
    says(cp, "--version", "v0.47.0");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "weft" }] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: false });
  });

  it("says there are no credentials when the credentials check fails", async () => {
    cp.failures.set("auth credentials list --json", new Error("no credentials"));
    says(cp, "--version", "v0.47.0");
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: false, accounts: [] });
  });

  it("says there are no accounts when the account list fails", async () => {
    cp.failures.set("auth tokens list --json", new Error("offline"));
    says(cp, "--version", "v0.47.0");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "mine" }] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: true, accounts: [] });
  });

  it("says there are no credentials when gog lists none", async () => {
    says(cp, "--version", "v0.47.0");
    says(cp, "auth credentials list --json", JSON.stringify({}));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    expect(await gog.gogStatus()).toMatchObject({ ownClient: false, accounts: [] });
  });

  it("shows the account being signed in and the last error", async () => {
    says(cp, "--version", "v0.47.0");
    says(cp, "auth credentials list --json", JSON.stringify({ clients: [{ client: "mine" }] }));
    says(cp, "auth tokens list --json", JSON.stringify({ keys: [] }));

    await gog.addGogAccount("me@example.com");
    expect(await gog.gogStatus()).toMatchObject({ adding: "me@example.com", lastError: null });

    child(cp).emit("close", 1, null);
    expect(await gog.gogStatus()).toMatchObject({ adding: null, lastError: "gog auth add exited with 1" });
  });
});

describe("weftClientJson", () => {
  it("is nothing when this build carries no client", () => {
    expect(gog.weftClientJson()).toBeNull();
  });

  it("is a Desktop client when the build carries one", () => {
    vi.stubEnv("WEFT_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    vi.stubEnv("WEFT_GOOGLE_CLIENT_SECRET", "shh");
    expect(JSON.parse(gog.weftClientJson()!)).toEqual({
      installed: {
        client_id: "abc.apps.googleusercontent.com",
        client_secret: "shh",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        redirect_uris: ["http://localhost"],
      },
    });
    vi.unstubAllEnvs();
  });

  it("is nothing when only one half of the client is there", () => {
    vi.stubEnv("WEFT_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    expect(gog.weftClientJson()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("setGogCredentials", () => {
  it("passes the client JSON to gog on stdin", async () => {
    const json = JSON.stringify({ installed: { client_id: "abc.apps.googleusercontent.com" } });
    await gog.setGogCredentials(json);

    expect(cp.execFile).toHaveBeenCalledWith(
      "/usr/local/bin/gog",
      ["auth", "credentials", "set", "-"],
      expect.objectContaining({ env: { PATH: "/usr/bin" }, timeout: 15_000, encoding: "utf8" }),
      expect.any(Function),
    );
    expect(cp.stdin).toEqual([json]);
  });

  it("refuses JSON that isn't an OAuth client", async () => {
    await expect(gog.setGogCredentials("nope")).rejects.toThrow("That file isn't JSON.");
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it("throws when gog isn't installed", async () => {
    cp.which.mockImplementation(() => {
      throw new Error("not found");
    });
    await expect(gog.setGogCredentials(JSON.stringify({ installed: { client_id: "abc" } }))).rejects.toThrow("gog isn't on this app's PATH.");
  });

  it("falls back to the process's own message when gog says nothing", async () => {
    cp.failures.set("auth credentials set -", new Error("gog exited with 1"));
    cp.quietFailures.add("auth credentials set -");
    await expect(gog.setGogCredentials(JSON.stringify({ installed: { client_id: "abc" } }))).rejects.toThrow("gog exited with 1");
  });
});

describe("removeGogAccount", () => {
  it("refuses an email that isn't one", async () => {
    await expect(gog.removeGogAccount("nope")).rejects.toThrow("Unknown account.");
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it("asks gog to remove the account without asking", async () => {
    await gog.removeGogAccount("me@example.com", "mine");
    expect(cp.execFile).toHaveBeenCalledWith(
      "/usr/local/bin/gog",
      ["auth", "remove", "me@example.com", "--client", "mine", "--force", "--no-input"],
      expect.objectContaining({ env: { PATH: "/usr/bin" }, timeout: 15_000, encoding: "utf8" }),
      expect.any(Function),
    );
  });

  it("removes through the default client when none is named", async () => {
    await gog.removeGogAccount("me@example.com");
    expect(cp.execFile).toHaveBeenCalledWith(
      "/usr/local/bin/gog",
      ["auth", "remove", "me@example.com", "--client", "default", "--force", "--no-input"],
      expect.objectContaining({ env: { PATH: "/usr/bin" }, timeout: 15_000, encoding: "utf8" }),
      expect.any(Function),
    );
  });

  it("refuses a client name that isn't one", async () => {
    await expect(gog.removeGogAccount("me@example.com", "not a client")).rejects.toThrow("Unknown account.");
    expect(cp.execFile).not.toHaveBeenCalled();
  });
});

describe("GOG_VERSION", () => {
  it("is the version the toolchain bundles", () => {
    const source = fs.readFileSync(new URL("../scripts/bundle-toolchain.mjs", import.meta.url), "utf8");
    const match = /export const GOG_VERSION = "([^"]+)"/.exec(source);
    expect(match?.[1]).toBe(gog.GOG_VERSION);
  });
});
