import { describe, expect, it } from "vitest";
import { fakeClock, fakeCdp, fakePage, make, point } from "./pane-input-fakes";
import { createPaneInput } from "./pane-input.cjs";

describe("createPaneInput", () => {
  describe("scroll", () => {
    it("brings a target into view", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: {} } }),
      });
      await expect(input.scroll(wc, { ref: "e1" })).resolves.toEqual({ scrolled: "e1" });
      const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
      expect(call[2].functionDeclaration).toContain("scrollIntoView");
    });

    it("wheels the page down", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": (p) => {
          if (String(p.expression).includes("innerWidth")) return { result: { value: { x: 100, y: 200 } } };
          return { result: { value: { scrollY: 600, height: 3000, viewport: 800 } } };
        },
      });
      await expect(input.scroll(wc, { direction: "down" })).resolves.toEqual({ scrollY: 600, height: 3000, viewport: 800 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 100,
        y: 200,
        deltaX: 0,
        deltaY: 600,
      });
    });

    it("wheels up, left and right", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": (p) => {
          if (String(p.expression).includes("innerWidth")) return { result: { value: { x: 0, y: 0 } } };
          return { result: { value: {} } };
        },
      });
      await input.scroll(wc, { direction: "up", amount: 100 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: -100 });
      await input.scroll(wc, { direction: "left", amount: 100 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: -100, deltaY: 0 });
      await input.scroll(wc, { direction: "right", amount: 100 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 100, deltaY: 0 });
    });

    it("wheels over a target", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ x: 7, y: 8 }),
        "Runtime.evaluate": () => ({ result: { value: {} } }),
      });
      await input.scroll(wc, { ref: "e1", direction: "down" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 7,
        y: 8,
        deltaX: 0,
        deltaY: 600,
      });
    });

    it("says when the direction is wrong", async () => {
      const { wc, input } = make({});
      await expect(input.scroll(wc, { direction: "sideways" })).rejects.toThrow("direction is up, down, left or right.");
    });

    it("keeps the amount inside its bounds", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": (p) => {
          if (String(p.expression).includes("innerWidth")) return { result: { value: { x: 0, y: 0 } } };
          return { result: { value: {} } };
        },
      });
      await input.scroll(wc, { direction: "down", amount: 0 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 600 });
      await input.scroll(wc, { direction: "down", amount: 999_999 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 10_000 });
      await input.scroll(wc, { direction: "down", amount: -5 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 1 });
    });
  });

  describe("waitFor", () => {
    it("waits for text to show up", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: true } }),
      });
      await expect(input.waitFor(wc, { text: "Done" })).resolves.toEqual({ waitedMs: 0 });
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain('document.body.innerText.includes("Done")');
    });

    it("waits for text to go", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: true } }),
      });
      await input.waitFor(wc, { gone: "Loading" });
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain('!(');
      expect(evaluate[2].expression).toContain('document.body.innerText.includes("Loading")');
    });

    it("waits for a selector to show up", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { value: true } }),
      });
      await input.waitFor(wc, { selector: "#done" });
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain('document.querySelector("#done")');
    });

    it("wants something to wait for", async () => {
      const { wc, input } = make({});
      await expect(input.waitFor(wc, {})).rejects.toThrow("Give text to wait for, gone (text to wait to disappear), or a selector.");
    });

    it("gives up after the timeout", async () => {
      const clock = fakeClock();
      const { wc, input } = make(
        {
          "Runtime.evaluate": () => ({ result: { value: false } }),
        },
        { now: clock.now, wait: () => Promise.resolve(clock.advance(1000)) },
      );
      await expect(input.waitFor(wc, { text: "Done", timeout: 2000 })).rejects.toThrow(
        'Waited 2s and "Done" never showed up.',
      );
    });

    it("says what it waited for when a selector never came", async () => {
      const clock = fakeClock();
      const { wc, input } = make(
        {
          "Runtime.evaluate": () => ({ result: { value: false } }),
        },
        { now: clock.now, wait: () => Promise.resolve(clock.advance(1000)) },
      );
      await expect(input.waitFor(wc, { selector: "#done", timeout: 1000 })).rejects.toThrow(
        "Waited 1s and #done never appeared.",
      );
    });

    it("says when a gone text is still there", async () => {
      const clock = fakeClock();
      const { wc, input } = make(
        {
          "Runtime.evaluate": () => ({ result: { value: false } }),
        },
        { now: clock.now, wait: () => Promise.resolve(clock.advance(1000)) },
      );
      await expect(input.waitFor(wc, { gone: "Loading", timeout: 1000 })).rejects.toThrow(
        'Waited 1s and "Loading" is still there.',
      );
    });

    it("keeps waiting while the page is loading", async () => {
      const clock = fakeClock();
      let loading = true;
      const cdp = fakeCdp({ "Runtime.evaluate": () => ({ result: { value: true } }) });
      const wc = { ...fakePage(), isLoading: () => loading };
      const input = createPaneInput({ cdp, wait: () => Promise.resolve(clock.advance(100)), now: clock.now });
      const waiting = input.waitFor(wc, { text: "Done", timeout: 5000 });
      loading = false;
      await expect(waiting).resolves.toMatchObject({ waitedMs: expect.any(Number) as unknown });
    });
  });
});
