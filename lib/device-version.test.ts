import { describe, expect, it } from "vitest";
import { compareVersions, countsText, newestVersion, parseBuild, versionCounts, versionText, versionsOf } from "./device-version";

describe("parseBuild", () => {
  it("splits a version and its short commit", () => {
    expect(parseBuild("0.7.0+d9b7166abcdef")).toEqual({ version: "0.7.0", commit: "d9b7166" });
    expect(parseBuild("0.7.0")).toEqual({ version: "0.7.0", commit: null });
    expect(parseBuild("0.7.0-beta.1+abc1234-dirty")).toEqual({ version: "0.7.0-beta.1", commit: "abc1234" });
  });
  it("refuses what isn't a build", () => {
    expect(parseBuild(null)).toBeNull();
    expect(parseBuild("latest")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares by number, and a prerelease before its release", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.6.6", "0.7.0")).toBe(-1);
    expect(compareVersions("0.7.0", "0.7.0")).toBe(0);
    expect(compareVersions("0.7.0-beta", "0.7.0")).toBe(-1);
    expect(compareVersions("0.7.0", "0.7.0-beta")).toBe(1);
    expect(compareVersions("0.7.0-a", "0.7.0-b")).toBe(-1);
    expect(compareVersions("0.7.0-b", "0.7.0-a")).toBe(1);
  });
});

describe("newestVersion and versionText", () => {
  it("finds the newest and flags the older", () => {
    expect(newestVersion([null, "x", "0.6.6+abc1234", "0.7.0+d9b7166", "0.6.9"])).toBe("0.7.0");
    expect(newestVersion([])).toBeNull();
    expect(versionText("0.7.0+d9b7166", "0.7.0")).toBe("0.7.0 (d9b7166)");
    expect(versionText("0.6.6+abc1234", "0.7.0")).toBe("0.6.6 (abc1234, older)");
    expect(versionText("0.6.6", "0.7.0")).toBe("0.6.6 (older)");
    expect(versionText("0.7.0", null)).toBe("0.7.0");
    expect(versionText(null, "0.7.0")).toBeNull();
  });
});

const rows = [
  { id: "u1", devices: [{ kind: "mac", name: "A", build: "0.7.0+abc1234", channel: "release" }, { kind: "worker", name: "W", build: "0.6.6+fff0000", channel: null }, { kind: "mac", name: "B", build: null, channel: "dev" }] },
  { id: "u2", devices: [{ kind: "mac", name: "C", build: "0.7.0+abc1234", channel: "release" }, { kind: "mac", name: "D", build: "0.7.0", channel: "dev" }, { kind: "mac", name: "E", build: "0.7.0", channel: null }] },
];

describe("versionsOf and versionCounts", () => {
  it("lists each device that reports", () => {
    expect(versionsOf(rows[0]!.devices)).toEqual(["Mac 0.7.0 (abc1234)", "Worker 0.6.6 (fff0000)"]);
    expect(versionsOf(rows[1]!.devices)).toEqual(["Mac 0.7.0 (abc1234)", "Mac 0.7.0", "Mac 0.7.0"]);
  });
  it("counts devices and accounts per version and channel", () => {
    const counts = versionCounts(rows);
    expect(counts).toEqual([
      { version: "0.7.0", channel: "dev", users: 1, devices: 1 },
      { version: "0.7.0", channel: "release", users: 2, devices: 3 },
      { version: "0.6.6", channel: "worker", users: 1, devices: 1 },
    ]);
    expect(countsText(counts)).toBe("0.7.0 dev ×1 · 0.7.0 release ×3 · 0.6.6 worker ×1");
  });
});
