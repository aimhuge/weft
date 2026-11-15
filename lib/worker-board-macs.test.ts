import { describe, expect, it } from "vitest";
import { expandOnMac, findMac, homeOf, isMacPath, isTilde, macLabels, macPath, parseMacPath, sameMac } from "./worker-board-macs";

const air = "a".repeat(64);
const air2 = "c".repeat(64);
const mini = "b".repeat(64);

describe("isMacPath", () => {
  it("is a mac:// path, case aside", () => {
    expect(isMacPath("mac://Air/x")).toBe(true);
    expect(isMacPath("MAC://Air/x")).toBe(true);
    expect(isMacPath("/Users/me/mac://")).toBe(false);
  });
});

describe("macLabels", () => {
  it("is each Mac's name when it's the only one by that name, else the start of its id", () => {
    const labels = macLabels(
      [
        { device: air, name: "Air" },
        { device: air2, name: "air " },
        { device: mini, name: "mini" },
      ],
      [mini, "d".repeat(64)],
    );
    expect([...labels]).toEqual([
      [air, "aaaaaaaaaaaa"],
      [air2, "cccccccccccc"],
      [mini, "mini"],
      ["d".repeat(64), "dddddddddddd"],
    ]);
  });

  it("never uses a name with a slash or no name at all", () => {
    expect([...macLabels([{ device: air, name: "a/b" }, { device: mini, name: "" }], [])]).toEqual([
      [air, "aaaaaaaaaaaa"],
      [mini, "bbbbbbbbbbbb"],
    ]);
  });
});

describe("macPath", () => {
  it("puts a path or a project name after the Mac", () => {
    expect(macPath("Air", "/Users/me/app")).toBe("mac://Air/Users/me/app");
    expect(macPath("Air", "app")).toBe("mac://Air/app");
  });
});

describe("parseMacPath", () => {
  it("reads an absolute path or a project name after the Mac", () => {
    expect(parseMacPath("mac://Air/Users/me/app")).toEqual({ mac: "Air", folder: "/Users/me/app" });
    expect(parseMacPath("mac://Air/app")).toEqual({ mac: "Air", folder: "app" });
    expect(parseMacPath("mac://Air/app/")).toEqual({ mac: "Air", folder: "app" });
    expect(parseMacPath("mac://Air/Users/me/app//")).toEqual({ mac: "Air", folder: "/Users/me/app" });
  });

  it("refuses a path with no Mac or no folder", () => {
    for (const bad of ["mac://", "mac://Air", "mac://Air/", "mac://Air//", "mac:///Users/me"]) expect(() => parseMacPath(bad)).toThrow(/isn't a Mac project/);
  });
});

describe("findMac", () => {
  const macs = [
    { device: air, name: "Air" },
    { device: air2, name: "Air" },
    { device: mini, name: "mini" },
  ];
  const labels = macLabels(macs, []);

  it("finds a Mac by id, the start of it, its name or its label", () => {
    expect(findMac(mini, labels, macs)).toBe(mini);
    expect(findMac("BBBBBBBB", labels, macs)).toBe(mini);
    expect(findMac("MINI", labels, macs)).toBe(mini);
    expect(findMac("aaaaaaaaaaaa", labels, macs)).toBe(air);
  });

  it("says when a name is more than one Mac, and lists the Macs when it's none", () => {
    expect(() => findMac("air", labels, macs)).toThrow("“air” is more than one of your Macs: pass one by its id instead (aaaaaaaaaaaa, cccccccccccc).");
    expect(() => findMac("bbb", labels, macs)).toThrow("No Mac “bbb” on your board. Your Macs: aaaaaaaaaaaa, cccccccccccc, mini.");
    expect(() => findMac("x", new Map(), [])).toThrow("Your Macs: none with cards or online yet.");
  });
});

describe("sameMac", () => {
  const old = "d".repeat(64);
  const repaired = "e".repeat(64);
  const other = "f".repeat(64);

  it("is the live Mac when the other device id is a revoked one (a re-pair)", () => {
    expect(sameMac([old, repaired], [{ device: repaired, name: "Mac" }])).toBe(repaired);
  });

  it("is the one seen last when the live ones share a name, case aside", () => {
    expect(
      sameMac(
        [old, repaired],
        [
          { device: repaired, name: "Mac" },
          { device: old, name: "mac " },
        ],
      ),
    ).toBe(repaired);
  });

  it("is null for really different Macs, or when none is known to be live", () => {
    expect(
      sameMac(
        [repaired, other],
        [
          { device: repaired, name: "Mac" },
          { device: other, name: "Air" },
        ],
      ),
    ).toBeNull();
    expect(sameMac([old, repaired], [])).toBeNull();
  });
});

describe("~ paths", () => {
  it("knows a ~ path", () => {
    expect(isTilde("~")).toBe(true);
    expect(isTilde("~/dev/weft")).toBe(true);
    expect(isTilde("~me/dev")).toBe(false);
    expect(isTilde("/Users/me")).toBe(false);
  });

  it("finds the home a Mac path sits in", () => {
    expect(homeOf("/Users/me/dev/weft")).toBe("/Users/me");
    expect(homeOf("/home/me/app")).toBe("/home/me");
    expect(homeOf("/opt/app")).toBeNull();
  });

  it("expands ~ to the one home the Mac's folders show, else null", () => {
    expect(expandOnMac("~/dev/weft", ["/Users/me/app", "/opt/x"])).toBe("/Users/me/dev/weft");
    expect(expandOnMac("~", ["/Users/me/app"])).toBe("/Users/me");
    expect(expandOnMac("~/dev", [])).toBeNull();
    expect(expandOnMac("~/dev", ["/Users/me/a", "/Users/you/b"])).toBeNull();
  });

  it("leaves a ~ path in a mac:// path as written", () => {
    expect(parseMacPath("mac://mini/~/dev/weft")).toEqual({ mac: "mini", folder: "~/dev/weft" });
    expect(parseMacPath("mac://mini/~")).toEqual({ mac: "mini", folder: "~" });
  });
});
