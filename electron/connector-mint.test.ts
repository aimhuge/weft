// Tokens minted from this Mac's own sign-ins (electron/connector-mint.cjs): Google's refresh token exported once into a
// private temp folder that's removed at once, kept in memory and traded for hour-long access tokens; gh's token by name.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clientOf, createMint, findBin, GH_TTL_MS } from "./connector-mint.cjs";

const NOW = 1_000;
const clientFile = (json: unknown) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-gog-client-")), "credentials.json");
  fs.writeFileSync(file, JSON.stringify(json));
  return file;
};

type Gog = { exported?: unknown; client?: unknown; keys?: string[] };
const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

function gog({ exported = { refresh_token: "1//refresh" }, client = { client_id: "id", client_secret: "sec" }, keys = ["token:default:me@example.com"] }: Gog = {}) {
  const tmps: string[] = [];
  const credentials = clientFile(client);
  const exec = vi.fn((_bin: string, args: string[]) => {
    if (args[2] === "list" && args[1] === "tokens") return Promise.resolve(JSON.stringify({ keys }));
    if (args[1] === "credentials") return Promise.resolve(JSON.stringify({ clients: [{ client: "default", path: credentials }] }));
    fs.writeFileSync(String(args[args.indexOf("--out") + 1]), JSON.stringify(exported));
    return Promise.resolve("");
  });
  const fetchImpl = vi.fn((_url: string, init: { body: URLSearchParams }) => Promise.resolve(reply({ access_token: `ya29.${String(init.body.get("refresh_token"))}`, expires_in: 3599 })));
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "weft-gog-export-"));
    tmps.push(d);
    return d;
  };
  const mint = createMint({ exec, fetchImpl: fetchImpl as never, which: (n: string) => `/bin/${n}`, tmp, now: () => NOW });
  return { mint, exec, fetchImpl, tmps };
}

describe("createMint gog", () => {
  it("exports the refresh token once, removes the export, and trades it for an access token each time", async () => {
    const g = gog();
    expect(await g.mint.gog("me@example.com")).toEqual({ token: "ya29.1//refresh", account: "me@example.com", expiresAt: NOW + 3_599_000 });
    expect(g.exec).toHaveBeenCalledWith("/bin/gog", expect.arrayContaining(["auth", "tokens", "export", "me@example.com", "--client", "default"]));
    expect(g.tmps.every((d) => !fs.existsSync(d))).toBe(true);
    const body = g.fetchImpl.mock.calls[0]?.[1].body ?? new URLSearchParams();
    expect(Object.fromEntries(body)).toEqual({ grant_type: "refresh_token", refresh_token: "1//refresh", client_id: "id", client_secret: "sec" });
    await g.mint.gog("me@example.com");
    expect(g.exec.mock.calls.filter(([, a]) => a.includes("export"))).toHaveLength(1);
    g.mint.forget("me@example.com");
    await g.mint.gog("me@example.com");
    expect(g.exec.mock.calls.filter(([, a]) => a.includes("export"))).toHaveLength(2);
  });

  it("reads a nested refresh token and the console's client file, and an hour when Google names no expiry", async () => {
    const g = gog({ exported: { token: { refresh_token: "1//nested" } }, client: { installed: { client_id: "i", client_secret: "s" } } });
    g.fetchImpl.mockResolvedValueOnce(reply({ access_token: "ya29.x" }));
    expect((await g.mint.gog("me@example.com")).expiresAt).toBe(NOW + 3_600_000);
  });

  it("says why it can't mint, and forgets a refresh token Google refused", async () => {
    await expect(gog({ keys: [] }).mint.gog("me@example.com")).rejects.toThrow("isn't signed in to gog on this Mac");
    await expect(gog({ exported: {} }).mint.gog("me@example.com")).rejects.toThrow("no refresh token");
    await expect(gog({ client: { client_id: "only" } }).mint.gog("me@example.com")).rejects.toThrow("has no id and secret");
    const other = gog();
    other.exec.mockImplementation((_b: string, args: string[]) => {
      if (args[1] === "credentials") return Promise.resolve(JSON.stringify({}));
      if (args.includes("list")) return Promise.resolve(JSON.stringify({ keys: ["token:default:me@example.com"] }));
      fs.writeFileSync(String(args[args.indexOf("--out") + 1]), '{"refresh_token":"r"}');
      return Promise.resolve("");
    });
    await expect(other.mint.gog("me@example.com")).rejects.toThrow('gog\'s OAuth client "default" isn\'t on this Mac.');
    const refused = gog();
    refused.fetchImpl.mockResolvedValueOnce(reply({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, false, 400));
    await expect(refused.mint.gog("me@example.com")).rejects.toThrow("Google refused to refresh me@example.com: Token has been expired or revoked.");
    refused.fetchImpl.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new Error("html")) });
    await expect(refused.mint.gog("me@example.com")).rejects.toThrow(": 500.");
    expect(refused.exec.mock.calls.filter(([, a]) => a.includes("export"))).toHaveLength(2);
    const quiet = gog();
    quiet.exec.mockImplementation((_b: string, args: string[]) => Promise.resolve(args.includes("list") ? JSON.stringify({}) : ""));
    await expect(quiet.mint.gog("me@example.com")).rejects.toThrow("isn't signed in");
  });
});

describe("createMint gh", () => {
  it("takes gh's token for the account, forgotten on the worker after GH_TTL_MS", async () => {
    const exec = vi.fn((_b: string, args: string[]) => Promise.resolve(args[0] === "api" ? "octocat\n" : "gho_abcdefghijklmnopqrstuvwxyz\n"));
    const mint = createMint({ exec, which: (n: string) => `/bin/${n}`, now: () => NOW });
    expect(await mint.gh("octocat")).toEqual({ token: "gho_abcdefghijklmnopqrstuvwxyz", account: "octocat", expiresAt: NOW + GH_TTL_MS });
    expect(exec).toHaveBeenCalledWith("/bin/gh", ["auth", "token", "--hostname", "github.com", "--user", "octocat"]);
    await mint.gh("");
    expect(exec).toHaveBeenLastCalledWith("/bin/gh", ["auth", "token", "--hostname", "github.com"]);
    expect(await mint.ghAccount()).toBe("octocat");
  });

  it("says when gh isn't there or isn't signed in", async () => {
    await expect(createMint({ which: () => null }).gh("x")).rejects.toThrow("gh isn't installed on this Mac.");
    const out = createMint({ exec: () => Promise.resolve("not a token"), which: (n: string) => n });
    await expect(out.gh("x")).rejects.toThrow("isn't signed in to GitHub");
    await expect(out.ghAccount()).rejects.toThrow("isn't signed in to GitHub");
  });
});

describe("findBin and clientOf", () => {
  it("finds a program on PATH or the usual places", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-bin-"));
    fs.writeFileSync(path.join(dir, "gh"), "", { mode: 0o755 });
    expect(findBin("gh", { env: { PATH: `:${dir}` }, extra: [] })).toBe(path.join(dir, "gh"));
    expect(findBin("gh", { env: {}, extra: [dir] })).toBe(path.join(dir, "gh"));
    expect(findBin("nope-not-here", { env: {}, extra: [dir] })).toBeNull();
    expect(typeof findBin("sh")).toBe("string");
  });

  it("reads a client from gog's form or the console's", () => {
    expect(clientOf({ web: { client_id: "a", client_secret: "b" } })).toEqual({ clientId: "a", clientSecret: "b" });
    expect(() => clientOf(null)).toThrow();
  });
});
