import { describe, expect, it } from "vitest";
import { freePort, isolatedPort, withPort } from "./worktree-port";

const worktree = { path: "/w", branch: "weft/a", base: "x", repo: "/r" };

describe("isolatedPort", () => {
  it("gives an isolated card one free port for life, and none to shared cards or commands with a port", async () => {
    const port = await isolatedPort({ id: "p1", worktree }, "pnpm dev");
    expect(port).toBeGreaterThan(1024);
    expect(await isolatedPort({ id: "p1", worktree }, "pnpm dev")).toBe(port);
    expect(await isolatedPort({ id: "p2" }, "pnpm dev")).toBeUndefined();
    expect(await isolatedPort(undefined, "pnpm dev")).toBeUndefined();
    expect(await isolatedPort({ id: "p3", worktree }, "pnpm dev --port 4001")).toBeUndefined();
  });

  it("finds a free port", async () => {
    expect(await freePort()).toBeGreaterThan(0);
  });
});

describe("withPort", () => {
  it("moves a local url to the card's port and leaves the rest alone", () => {
    expect(withPort("http://localhost:3000/x?y=1", 5555)).toBe("http://localhost:5555/x?y=1");
    expect(withPort("http://127.0.0.1:3000", 5555)).toBe("http://127.0.0.1:5555/");
    expect(withPort("https://example.com", 5555)).toBe("https://example.com");
    expect(withPort("http://localhost:3000", undefined)).toBe("http://localhost:3000");
    expect(withPort(undefined, 5555)).toBeUndefined();
    expect(withPort("not a url", 5555)).toBe("not a url");
  });
});
