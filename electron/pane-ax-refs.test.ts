import { describe, expect, it } from "vitest";
import { parseRef, refOf } from "./pane-ax.cjs";

describe("parseRef", () => {
  it("reads the number out of a ref", () => {
    expect(parseRef("e123")).toBe(123);
    expect(parseRef(" e7 ")).toBe(7);
    expect(parseRef("e0")).toBe(0);
  });

  it("is undefined for anything that isn't a ref", () => {
    expect(parseRef("e")).toBeUndefined();
    expect(parseRef("e12a")).toBeUndefined();
    expect(parseRef("x12")).toBeUndefined();
    expect(parseRef("")).toBeUndefined();
    expect(parseRef(undefined)).toBeUndefined();
    expect(parseRef(null)).toBeUndefined();
  });
});

describe("refOf", () => {
  it("is the backendDOMNodeId with an e on the front", () => {
    expect(refOf({ backendDOMNodeId: 42 })).toBe("e42");
  });

  it("is undefined when the node has no backend id", () => {
    expect(refOf({})).toBeUndefined();
    expect(refOf({ backendDOMNodeId: 0 })).toBeUndefined();
  });
});
