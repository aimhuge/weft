import { describe, expect, it, vi } from "vitest";

vi.mock("./settings", () => ({ listProjects: () => [{ path: "/dev/ling" }], workerFolders: () => ["/dev/other"] }));
vi.mock("./repos", () => ({ githubRepoOf: (f: string) => (f === "/dev/ling" ? "ada/ling" : undefined) }));
const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-shell", () => ({ shell }));

const { connectorStart, repoForWorkerFolder, START_CONNECTOR } = await import("./worker-folder-repo");

describe("repoForWorkerFolder", () => {
  it("finds the one origin this Mac knows the folder by, by name", () => {
    const deps = { folders: () => ["/a/Ling", "/b/ling", "/c/web", "/d/ling"], repoOf: (f: string) => ({ "/a/Ling": "Ada/Ling", "/b/ling": "ada/ling", "/d/ling": undefined })[f] };
    expect(repoForWorkerFolder("LING", deps)).toBe("ada/ling");
  });

  it("is null for a folder it doesn't have, or two with different origins", () => {
    expect(repoForWorkerFolder("web", { folders: () => ["/c/web"], repoOf: () => undefined })).toBeNull();
    expect(repoForWorkerFolder("x", { folders: () => [], repoOf: () => "a/b" })).toBeNull();
    expect(repoForWorkerFolder("ling", { folders: () => ["/a/ling", "/b/ling"], repoOf: (f) => (f === "/a/ling" ? "a/ling" : "b/ling") })).toBeNull();
  });

  it("reads this Mac's projects and worker folders by default", () => {
    expect(repoForWorkerFolder("ling")).toBe("ada/ling");
    expect(repoForWorkerFolder("other")).toBeNull();
  });
});

describe("connectorStart", () => {
  const o = { workerId: "w1", cardId: "c1", folder: "ling" };
  const signed = { key: "k", sig: "s", issuedAt: 1 };

  it("carries the repo and main's signature over the start", async () => {
    const sign = vi.fn(() => Promise.resolve(signed));
    expect(await connectorStart(o, { repoOf: () => "ada/ling", sign })).toEqual({ repo: "ada/ling", start: signed });
    expect(sign).toHaveBeenCalledWith({ ...o, repo: "ada/ling" });
  });

  it("carries the repo alone when main won't sign, and nothing for a folder this Mac doesn't know", async () => {
    expect(await connectorStart(o, { repoOf: () => "ada/ling", sign: () => Promise.reject(new Error("no app")) })).toEqual({ repo: "ada/ling" });
    const sign = vi.fn();
    expect(await connectorStart(o, { repoOf: () => null, sign })).toEqual({});
    expect(sign).not.toHaveBeenCalled();
  });

  it("asks main over its control server by default", async () => {
    shell.mockResolvedValueOnce(signed);
    expect(await connectorStart(o)).toEqual({ repo: "ada/ling", start: signed });
    expect(shell).toHaveBeenCalledWith("/connectors/sign-start", { ...o, repo: "ada/ling" });
    expect(START_CONNECTOR.repoOf("other")).toBeNull();
  });
});
