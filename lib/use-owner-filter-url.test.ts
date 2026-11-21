// @vitest-environment jsdom
// The board's person and machine filters ride in the URL: read once on mount, written back on every change.
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { RailFilter } from "./rail-view";
import { useOwnerFilterUrl } from "./use-owner-filter-url";

const run = (initial: RailFilter = {}) =>
  renderHook(() => {
    const [filter, setFilter] = useState<RailFilter>(initial);
    useOwnerFilterUrl(filter, setFilter);
    return { filter, setFilter };
  });

afterEach(() => window.history.replaceState(null, "", "/"));

describe("useOwnerFilterUrl", () => {
  it("takes ?who and ?on from the URL on mount, keeping the rest of the filter", () => {
    window.history.replaceState(null, "", "/board?card=c1&who=u2&on=worker%3Aw1");
    const { result } = run({ tag: "bug" });
    expect(result.current.filter).toEqual({ tag: "bug", who: "u2", on: "worker:w1" });
    expect(window.location.search).toBe("?card=c1&who=u2&on=worker%3Aw1");
  });

  it("writes the filter back as it changes, dropping what's cleared", () => {
    window.history.replaceState(null, "", "/board?card=c1");
    const { result } = run();
    expect(window.location.search).toBe("?card=c1");
    act(() => result.current.setFilter({ who: "me", on: "here" }));
    expect(window.location.search).toBe("?card=c1&who=me&on=here");
    act(() => result.current.setFilter({ who: "me" }));
    expect(window.location.search).toBe("?card=c1&who=me");
    act(() => result.current.setFilter({}));
    expect(window.location.search).toBe("?card=c1");
  });

  it("leaves a filter the page already handed over as it is", () => {
    window.history.replaceState(null, "", "/board?who=u2");
    const { result } = run({ who: "u2" });
    expect(result.current.filter).toEqual({ who: "u2" });
  });
});
