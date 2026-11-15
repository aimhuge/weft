import { describe, expect, it } from "vitest";
import { CHIPS_MAX, composerLook, filterChips, oneBoxWhere, projectChips, showWherePill, wantsProjectChips } from "./one-box";
import type { LocalRepo } from "./types";

const repo = (name: string, extra: Partial<LocalRepo> = {}): LocalRepo => ({ path: `/dev/${name}`, name, git: true, activity: 0, ...extra });
const mac = { device: "mac-1", folder: "/dev/web", label: "web" };
const worker = { device: "worker:w1", folder: "ling", label: "ling (worker)" };

describe("wantsProjectChips", () => {
  it("offers chips only on this machine's disk with no project picked", () => {
    expect(wantsProjectChips(true)).toBe(true);
    expect(wantsProjectChips(true, "/dev/web")).toBe(false);
    expect(wantsProjectChips(false)).toBe(false);
  });
});

describe("projectChips", () => {
  it("is empty before the repos load", () => {
    expect(projectChips(null)).toEqual([]);
  });

  it("puts recent projects first, newest use first, then the rest by activity", () => {
    const chips = projectChips([
      repo("old", { activity: 1 }),
      repo("used", { recentAt: 5 }),
      repo("busy", { activity: 9 }),
      repo("latest", { recentAt: 7 }),
      repo("unset", { recentAt: 0 }),
    ]);
    expect(chips.map((c) => c.label)).toEqual(["latest", "used", "unset", "busy", "old"]);
    expect(chips[0]).toEqual({ path: "/dev/latest", label: "latest" });
  });

  it("caps the chips", () => {
    const many = Array.from({ length: CHIPS_MAX + 5 }, (_, i) => repo(`r${i}`));
    expect(projectChips(many)).toHaveLength(CHIPS_MAX);
  });
});

describe("filterChips", () => {
  const chips = [
    { path: "/dev/weft", label: "weft" },
    { path: "/work/site", label: "site" },
  ];
  it("keeps every chip for an empty filter", () => {
    expect(filterChips(chips, "  ")).toEqual(chips);
  });
  it("matches the name or the path", () => {
    expect(filterChips(chips, "WEF")).toEqual([chips[0]]);
    expect(filterChips(chips, "work")).toEqual([chips[1]]);
    expect(filterChips(chips, "nope")).toEqual([]);
  });
});

describe("oneBoxWhere", () => {
  it("names the folder, or nothing without one", () => {
    expect(oneBoxWhere("/Users/me/dev/weft")).toBe("weft");
    expect(oneBoxWhere("")).toBe("");
  });
  it("uses a place's label when the folder is a place key", () => {
    expect(oneBoxWhere("worker:w1\nling", [mac, worker])).toBe("ling (worker)");
    expect(oneBoxWhere("/dev/other", [mac])).toBe("other");
  });
});

describe("showWherePill", () => {
  it("shows only when there is more than one place to run", () => {
    expect(showWherePill()).toBe(false);
    expect(showWherePill([mac])).toBe(false);
    expect(showWherePill([mac, worker])).toBe(true);
  });
});

describe("composerLook", () => {
  it("fills the dialog in the full layout and sits at the bottom in the one-box one", () => {
    expect(composerLook(true)).toMatchObject({ key: "full", sizeClass: "h-full min-h-[180px]", className: "flex-1" });
    expect(composerLook(false)).toMatchObject({ key: "one-box", placeholder: "What should it build?", className: "shrink-0", look: "phone" });
    expect(composerLook(true).look).toBeUndefined();
  });
});
