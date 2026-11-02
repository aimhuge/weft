// lib/use-devices.ts outside a browser (the server render): no bridges to find. The hook itself is driven through
// components/DevicesSettings.test.tsx.
import { describe, expect, it } from "vitest";
import { bridgesHere } from "./use-devices";

describe("bridgesHere", () => {
  it("finds none without a window", () => {
    expect(bridgesHere()).toEqual({});
  });
});
