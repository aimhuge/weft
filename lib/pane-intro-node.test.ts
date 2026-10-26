// The web build renders the New thread dialog without a browser bridge, and server-rendered pages
// have no `window` at all. This file runs in the node environment to cover that branch:
// the pane-intro tests themselves need a DOM (localStorage, location.origin).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasPane } from "./pane-intro";

describe("hasPane without a window", () => {
  it("is false on the server, where there is no browser bridge", () => {
    expect(typeof window).toBe("undefined");
    expect(hasPane()).toBe(false);
  });
});
