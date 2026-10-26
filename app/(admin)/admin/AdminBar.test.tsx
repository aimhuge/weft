// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/components/test-utils";
import type { ShellBridge } from "@/lib/client";
import AdminBar from "./AdminBar";

afterEach(() => {
  cleanup();
  delete (window as { weft?: ShellBridge }).weft;
});

describe("AdminBar", () => {
  it("is a plain bar in a browser tab", () => {
    const { container } = render(<AdminBar>← Board</AdminBar>);
    const bar = container.querySelector("header");
    expect(bar?.className).toContain("px-5");
    expect(bar?.className).not.toContain("mac-title-bar");
  });

  it("clears the traffic lights and drags the window in the desktop app on a Mac", () => {
    window.weft = { platform: "darwin", zoomFactor: () => 1 } as unknown as ShellBridge;
    const { container } = render(<AdminBar>← Board</AdminBar>);
    const bar = container.querySelector("header");
    expect(bar?.className).toContain("mac-title-bar");
    expect(bar?.className).toContain("app-drag");
  });
});
