import { describe, expect, it } from "vitest";
import { macSource, parseMacSource } from "./mac-host-verbs-source";

describe("macSource", () => {
  it("round-trips a device id and a folder name", () => {
    const device = "ab12cd34".repeat(8);
    expect(macSource(device, "weft")).toBe(`mac:${device}/weft`);
    expect(parseMacSource(macSource(device, "weft"))).toEqual({ device, folder: "weft" });
  });

  it("reads nothing else", () => {
    for (const bad of ["worker://x/weft", "mac:/weft", "mac:abc/weft", "mac:ABCDEF0123/weft", `mac:${"a".repeat(8)}/`, `mac:${"a".repeat(8)}/a/b`, `mac:${"a".repeat(65)}/x`, ""]) {
      expect(parseMacSource(bad)).toBeNull();
    }
  });
});
