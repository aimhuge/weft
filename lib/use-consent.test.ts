// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { writeConsent } from "./consent";
import { useConsent } from "./use-consent";

beforeEach(() => localStorage.clear());

function Probe() {
  return createElement("span", null, String(useConsent()));
}

describe("useConsent", () => {
  it("is undefined on the server, so nothing about the choice lands in the HTML", () => {
    expect(renderToString(createElement(Probe))).toContain("undefined");
  });

  it("reads the stored choice and follows writeConsent()", () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current).toBeNull();
    act(() => writeConsent("granted"));
    expect(result.current).toBe("granted");
  });
});
