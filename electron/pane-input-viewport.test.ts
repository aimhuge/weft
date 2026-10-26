import { describe, expect, it } from "vitest";
import { make } from "./pane-input-fakes";
import { VIEWPORTS } from "./pane-input.cjs";

describe("createPaneInput", () => {
  describe("viewport", () => {
    it("sets a phone's size", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: { width: 390, height: 844 } } }),
      });
      await expect(input.viewport(wc, { size: "phone" })).resolves.toEqual({ width: 390, height: 844 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setDeviceMetricsOverride", VIEWPORTS.phone);
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    });

    it("sets a tablet's size", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: { width: 820, height: 1180 } } }),
      });
      await input.viewport(wc, { size: "tablet" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setDeviceMetricsOverride", VIEWPORTS.tablet);
    });

    it("goes back to the pane's own size", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: { width: 1200, height: 800 } } }),
      });
      await input.viewport(wc, { size: "desktop" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.clearDeviceMetricsOverride");
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setTouchEmulationEnabled", { enabled: false });
    });

    it("resets too", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: {} } }),
      });
      await input.viewport(wc, { size: "reset" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.clearDeviceMetricsOverride");
    });

    it("takes a custom size", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: { width: 500, height: 400 } } }),
      });
      await input.viewport(wc, { width: 500, height: 400 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setDeviceMetricsOverride", {
        width: 500,
        height: 400,
        deviceScaleFactor: 0,
        mobile: false,
      });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Emulation.setTouchEmulationEnabled", { enabled: false });
    });

    it("says what a size should be", async () => {
      const { wc, input } = make({});
      await expect(input.viewport(wc, { size: "watch" })).rejects.toThrow(
        'size is "phone", "tablet" or "desktop", or give width and height.',
      );
      await expect(input.viewport(wc, {})).rejects.toThrow('size is "phone", "tablet" or "desktop", or give width and height.');
    });
  });

  describe("snapshot", () => {
    it("reads the page's accessibility tree", async () => {
      const { wc, input } = make({
        "Accessibility.getFullAXTree": () => ({
          nodes: [
            { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] },
            {
              nodeId: "2",
              role: { value: "button" },
              name: { value: "Continue" },
              backendDOMNodeId: 19,
            },
          ],
        }),
      });
      await expect(input.snapshot(wc)).resolves.toEqual({ text: '- button "Continue" [ref=e19]', dropped: 0 });
    });

    it("copes with a page that has no tree", async () => {
      const { wc, input } = make({});
      await expect(input.snapshot(wc)).resolves.toEqual({ text: "", dropped: 0 });
    });
  });
});
