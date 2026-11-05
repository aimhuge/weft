import { describe, expect, it } from "vitest";
import { make, point } from "./pane-input-fakes";

describe("createPaneInput", () => {
  describe("element", () => {
    it("resolves a ref to an element", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
      });
      await expect(input.click(wc, { ref: "e12" })).resolves.toMatchObject({ clicked: "e12" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "DOM.resolveNode", { backendNodeId: 12, objectGroup: "weft-agent" });
    });

    it("says a ref that isn't one is wrong", async () => {
      const { wc, input } = make({});
      await expect(input.click(wc, { ref: "12" })).rejects.toThrow("12 isn't a ref; refs look like e123 and come from snapshot.");
    });

    it("says a ref that's gone is gone", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => {
          throw new Error("Could not find node");
        },
      });
      await expect(input.click(wc, { ref: "e12" })).rejects.toThrow("e12 isn't on the page any more; take a new snapshot.");
    });

    it("resolves a selector to an element", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { objectId: "obj-2" } }),
        "Runtime.callFunctionOn": () => point(),
      });
      await expect(input.click(wc, { selector: "#go" })).resolves.toMatchObject({ clicked: "#go" });
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain('document.querySelectorAll("#go")');
    });

    it("resolves a selector with a Playwright text pseudo-class", async () => {
      const { cdp, wc, input } = make({
        "Runtime.evaluate": () => ({ result: { objectId: "obj-3" } }),
        "Runtime.callFunctionOn": () => point(),
      });
      const selector = '[role="menu"] button[role="menuitem"]:has(span:text-is("Settings…"))';
      await expect(input.click(wc, { selector })).resolves.toMatchObject({ clicked: selector });
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain("Settings…");
    });

    it("wants a ref or a selector", async () => {
      const { wc, input } = make({});
      await expect(input.click(wc, {})).rejects.toThrow("Give a ref from snapshot, or a CSS selector.");
      await expect(input.click(wc, { selector: "   " })).rejects.toThrow("Give a ref from snapshot, or a CSS selector.");
    });

    it("says a selector that isn't one is wrong", async () => {
      const { wc, input } = make({
        "Runtime.evaluate": () => ({ exceptionDetails: { text: "SyntaxError" } }),
      });
      await expect(input.click(wc, { selector: "!!!" })).rejects.toThrow("!!! isn't a valid CSS selector.");
    });

    it("says when no element matches", async () => {
      const { wc, input } = make({
        "Runtime.evaluate": () => ({ result: {} }),
      });
      await expect(input.click(wc, { selector: "#nope" })).rejects.toThrow("No element matches #nope");
    });
  });

  describe("click", () => {
    it("moves the mouse to the element's middle and clicks", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ x: 100, y: 50 }),
      });
      await expect(input.click(wc, { ref: "e1" })).resolves.toEqual({ clicked: "e1" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 50 });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 100,
        y: 50,
        button: "left",
        clickCount: 1,
      });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 100,
        y: 50,
        button: "left",
        clickCount: 1,
      });
    });

    it("clicks twice for a double click", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point(),
      });
      await input.click(wc, { ref: "e1" }, { double: true });
      const presses = cdp.send.mock.calls.filter((c) => c[2].type === "mousePressed");
      expect(presses.map((c) => c[2].clickCount)).toEqual([1, 2]);
    });

    it("says when the element has no size", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ hidden: true }),
      });
      await expect(input.click(wc, { ref: "e1" })).rejects.toThrow(
        "e1 has no size on the page (hidden?); try its label, or snapshot for what's visible.",
      );
    });

    it("says when something is on top of the element", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ covered: 'div#modal "Sign up"' }),
      });
      await expect(input.click(wc, { ref: "e1" })).rejects.toThrow(
        'div#modal "Sign up" is on top of e1; close or click that first.',
      );
    });

    it("shows a ripple where it clicked", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ x: 100.4, y: 50.6 }),
      });
      await input.click(wc, { ref: "e1" });
      await Promise.resolve();
      const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
      expect(evaluate[2].expression).toContain("left:100px;top:51px");
    });
  });

  describe("hover", () => {
    it("moves the mouse over the element", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => point({ x: 5, y: 6 }),
      });
      await expect(input.hover(wc, { ref: "e1" })).resolves.toEqual({ hovered: "e1" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 6 });
    });
  });

  describe("press", () => {
    it("sends the key events", async () => {
      const { cdp, wc, input } = make({});
      await expect(input.press(wc, "Enter")).resolves.toEqual({ pressed: "Enter" });
      const keys = cdp.send.mock.calls.filter((c) => c[1] === "Input.dispatchKeyEvent");
      expect(keys).toHaveLength(2);
      expect(keys[0]![2].type).toBe("keyDown");
      expect(keys[1]![2].type).toBe("keyUp");
    });

    it("focuses a target first", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: {} } }),
      });
      await input.press(wc, "Enter", { ref: "e1" });
      const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
      expect(call[2].functionDeclaration).toContain("this.focus()");
    });

    it("says a key it doesn't know", async () => {
      const { wc, input } = make({});
      await expect(input.press(wc, "Frobnicate")).rejects.toThrow(/isn't a key I know/);
    });
  });

  describe("type", () => {
    const field = () => ({ result: { value: {} } });

    it("replaces the field's contents with the text", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => field(),
      });
      await expect(input.type(wc, { ref: "e1" }, "hello")).resolves.toEqual({ typed: "e1" });
      expect(cdp.send).toHaveBeenCalledWith(wc, "Input.insertText", { text: "hello" });
    });

    it("says when it isn't a text field", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: { notField: true } } }),
      });
      await expect(input.type(wc, { ref: "e1" }, "x")).rejects.toThrow("e1 isn't a text field.");
    });

    it("clears the field with a backspace when there's no text", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => field(),
      });
      await input.type(wc, { ref: "e1" }, "");
      expect(cdp.send).not.toHaveBeenCalledWith(wc, "Input.insertText", { text: "" });
      const keys = cdp.send.mock.calls.filter((c) => c[1] === "Input.dispatchKeyEvent");
      expect(keys[0]![2].key).toBe("Backspace");
    });

    it("presses Enter to submit", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => field(),
      });
      await input.type(wc, { ref: "e1" }, "hello", { submit: true });
      const keys = cdp.send.mock.calls.filter((c) => c[1] === "Input.dispatchKeyEvent");
      expect(keys[0]![2].key).toBe("Enter");
    });
  });

  describe("select", () => {
    it("picks the option", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: { picked: ["Apple"] } } }),
      });
      await expect(input.select(wc, { ref: "e1" }, "Apple")).resolves.toEqual({ picked: ["Apple"] });
      const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
      expect(call[2].arguments).toEqual([{ value: ["Apple"] }]);
    });

    it("takes a list of options too", async () => {
      const { cdp, wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: { picked: ["Apple", "Pear"] } } }),
      });
      await input.select(wc, { ref: "e1" }, ["Apple", "Pear"]);
      const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
      expect(call[2].arguments).toEqual([{ value: ["Apple", "Pear"] }]);
    });

    it("says when it isn't a select", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: { notSelect: true } } }),
      });
      await expect(input.select(wc, { ref: "e1" }, "Apple")).rejects.toThrow(
        "e1 isn't a <select>; click it and pick the option instead.",
      );
    });

    it("lists the options when none match", async () => {
      const { wc, input } = make({
        "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }),
        "Runtime.callFunctionOn": () => ({ result: { value: { missing: ["Apple", "Pear"] } } }),
      });
      await expect(input.select(wc, { ref: "e1" }, "Plum")).rejects.toThrow(
        "No option matches Plum. The options are: Apple, Pear",
      );
    });
  });
});
