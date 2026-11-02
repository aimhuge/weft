import { describe, expect, it } from "vitest";
import { formatProjectAddress, isWorkerPath, LOCAL_HOST, localAddress, parseProjectAddress, workerAddress } from "./address";

describe("project addresses", () => {
  it("formats a worker's as worker://<id>/<folder> and a local one as its folder", () => {
    expect(formatProjectAddress(workerAddress("w1", "ling"))).toBe("worker://w1/ling");
    expect(formatProjectAddress(localAddress("/dev/app"))).toBe("/dev/app");
  });

  it("reads back what it formats", () => {
    expect(parseProjectAddress("worker://w1/a/b")).toEqual({ host: { kind: "worker", id: "w1" }, repo: "a/b" });
    expect(parseProjectAddress("/dev/app")).toEqual({ host: LOCAL_HOST, repo: "/dev/app" });
  });

  it("refuses an empty path and a worker path missing either half", () => {
    expect(parseProjectAddress("")).toBeNull();
    expect(parseProjectAddress("worker://w1")).toBeNull();
    expect(parseProjectAddress("worker://w1/")).toBeNull();
    expect(parseProjectAddress("worker:///ling")).toBeNull();
  });

  it("knows a worker path", () => {
    expect(isWorkerPath("worker://w1/ling")).toBe(true);
    expect(isWorkerPath("/dev/app")).toBe(false);
    expect(isWorkerPath(null)).toBe(false);
  });
});
