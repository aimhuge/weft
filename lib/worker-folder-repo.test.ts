import { describe, expect, it, vi } from "vitest";

vi.mock("./settings", () => ({ listProjects: () => [{ path: "/dev/ling" }], workerFolders: () => ["/dev/other"] }));
vi.mock("./repos", () => ({ githubRepoOf: (f: string) => (f === "/dev/ling" ? "ada/ling" : undefined) }));

const { repoForWorkerFolder } = await import("./worker-folder-repo");

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
