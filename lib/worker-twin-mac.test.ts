// A worker project's twin among this Mac's projects and worker folders (lib/worker-twin-mac.ts).
import { describe, expect, it, vi } from "vitest";

vi.mock("./settings", () => ({ listProjects: () => [{ path: "/dev/site" }, { path: "/dev/Ling" }], workerFolders: () => ["/dev/handed/app"] }));

const { macTwin } = await import("./worker-twin-mac");

describe("macTwin", () => {
  it("finds the project or worker folder of the worker project's name, and nothing for another", () => {
    expect(macTwin("worker://w1/ling")).toBe("/dev/Ling");
    expect(macTwin("worker://w1/app")).toBe("/dev/handed/app");
    expect(macTwin("worker://w1/none")).toBeNull();
    expect(macTwin("/dev/site")).toBeNull();
  });
});
