import { describe, expect, it } from "vitest";
import { make, fakeClock, type Params } from "./pane-input-fakes";
import { RELOAD_MS } from "./pane-focus.cjs";

// A page whose selector finds the element and whose glide answers what the test says.
const found = { result: { objectId: "o1" } };

function page({ glide = { text: "Round 3" }, fresh = [true], y = 420 }: { glide?: Record<string, unknown>; fresh?: boolean[]; y?: number } = {}) {
  const evals: string[] = [];
  let checks = 0;
  const handlers = {
    "Runtime.evaluate": (p: Params): unknown => {
      const expr = String(p.expression);
      evals.push(expr);
      if (p.objectGroup) return found;
      if (expr === "Math.round(scrollY)") return { result: { value: y } };
      if (expr.startsWith('document.readyState === "complete"')) return { result: { value: fresh[Math.min(checks++, fresh.length - 1)] } };
      return { result: { value: undefined } };
    },
    "Runtime.callFunctionOn": (): unknown => ({ result: { value: glide } }),
  };
  return { handlers, evals };
}

describe("focus", () => {
  it("glides to the section and flashes it with the label", async () => {
    const { handlers } = page();
    const { cdp, wc, input } = make(handlers);
    const r = await input.focus(wc, { selector: "#r3", label: "New in round 3" });
    expect(r).toEqual({ focused: "#r3", text: "Round 3", reloaded: false });
    const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
    expect(call[2].arguments).toEqual([{ value: "New in round 3" }]);
    expect(cdp.send.mock.calls.some((c) => c[1] === "Page.reload")).toBe(false);
  });

  it("reloads, puts the scroll back where the reader was, then glides", async () => {
    const { handlers, evals } = page({ fresh: [false, true] });
    const { cdp, wc, input } = make(handlers);
    const r = await input.focus(wc, { selector: "#r3", reload: true });
    expect(r.reloaded).toBe(true);
    expect(cdp.send.mock.calls.some((c) => c[1] === "Page.reload")).toBe(true);
    expect(evals).toContain('scrollTo({ top: 420, behavior: "instant" })');
  });

  it("needs something to focus", async () => {
    const { wc, input } = make(page().handlers);
    await expect(input.focus(wc, {})).rejects.toThrow("Give the selector");
  });

  it("refuses a ref alone with a reload, since refs don't survive it", async () => {
    const { wc, input } = make(page().handlers);
    await expect(input.focus(wc, { ref: "e12", reload: true })).rejects.toThrow("refs from before it are gone");
  });

  it("says when nothing matches after the reload", async () => {
    const { handlers } = page();
    handlers["Runtime.evaluate"] = ((orig) => (p: Params) => (p.objectGroup ? { result: {} } : orig(p)))(handlers["Runtime.evaluate"]);
    const { wc, input } = make(handlers);
    await expect(input.focus(wc, { selector: "#r9", reload: true })).rejects.toThrow("No element matches #r9 after the reload.");
  });

  it("says when the section has no size", async () => {
    const { wc, input } = make(page({ glide: { hidden: true } }).handlers);
    await expect(input.focus(wc, { selector: "#gone" })).rejects.toThrow("has no size");
  });

  it("gives up on a page that never finishes reloading", async () => {
    const clock = fakeClock();
    const { wc, input } = make(page({ fresh: [false] }).handlers, { now: clock.now, wait: () => Promise.resolve(clock.advance(1000)) });
    await expect(input.focus(wc, { selector: "#r3", reload: true })).rejects.toThrow(`${RELOAD_MS / 1000}s`);
  });

  it("focuses by ref when there's no reload", async () => {
    const { handlers } = page();
    const { wc, input } = make({ ...handlers, "DOM.resolveNode": () => ({ object: { objectId: "o2" } }) });
    expect((await input.focus(wc, { ref: "e12" })).focused).toBe("e12");
  });

  it("says when nothing matches, with no reload", async () => {
    const { handlers } = page();
    const { wc, input } = make({ ...handlers, "Runtime.evaluate": (p: Params) => (p.objectGroup ? { result: {} } : handlers["Runtime.evaluate"](p)) });
    await expect(input.focus(wc, { selector: "#r9" })).rejects.toThrow("No element matches #r9.");
  });

  it("keeps waiting while the reloading page can't answer, and reports a page script that fails", async () => {
    const { handlers } = page();
    let n = 0;
    const flaky = (p: Params) => {
      const expr = String(p.expression);
      if (expr.startsWith('document.readyState === "complete"')) return n++ ? { result: { value: true } } : Promise.reject(new Error("navigating"));
      return handlers["Runtime.evaluate"](p);
    };
    const ok = make({ ...handlers, "Runtime.evaluate": flaky });
    await expect(ok.input.focus(ok.wc, { selector: "#r3", reload: true })).resolves.toMatchObject({ reloaded: true });

    const broken = make({ ...handlers, "Runtime.evaluate": () => ({ exceptionDetails: { text: "boom" } }) });
    await expect(broken.input.focus(broken.wc, { selector: "#r3", reload: true })).rejects.toThrow("boom");
    const silent = make({ ...handlers, "Runtime.evaluate": () => ({ exceptionDetails: {} }) });
    await expect(silent.input.focus(silent.wc, { selector: "#r3", reload: true })).rejects.toThrow("The page script failed.");
  });

  it("cuts a long label", async () => {
    const { handlers } = page();
    const { cdp, wc, input } = make(handlers);
    await input.focus(wc, { selector: "#r3", label: "x".repeat(90) });
    const call = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
    expect((call[2].arguments as Array<{ value: string }>)[0]!.value).toHaveLength(60);
  });
});
