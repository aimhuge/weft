// @vitest-environment jsdom
// The worker layout's gate (electron/approval-worker.cjs): Allow stays off, and Touch ID unasked, until the end of the
// page has been on screen.
import { describe, expect, it } from "vitest";
import { approvalHtml } from "./approval-window.cjs";
import { marked } from "./approval-worker.cjs";

const view = { command: "npm run job", cwd: "app", names: ["K"], environment: "production", label: "o/r", worker: "m1mini" };

// The page's markup in this jsdom document, then its own script run as the window would run it.
function page(height: number) {
  const html = approvalHtml(view, { nonce: "n" });
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  const script = /<script nonce="n">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- runs the page's own script, as the window would
  new Function(script)();
  return window as unknown as Window & { __seen: Promise<boolean> };
}

describe("the worker gate", () => {
  it("turns Allow on once the end of the page is on screen", async () => {
    const win = page(0);
    const allow = win.document.querySelector("button[data-answer=once]") as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    expect(await win.__seen).toBe(true);
    expect(allow.disabled).toBe(false);
    expect(win.document.getElementById("seen-hint")).toBeNull();
  });

  it("waits while the end is below the fold, and opens on a scroll that reaches it", async () => {
    const win = page(10_000);
    let seen = false;
    void win.__seen.then(() => (seen = true));
    await new Promise((done) => setTimeout(done, 5));
    expect(seen).toBe(false);
    Object.defineProperty(win, "scrollY", { configurable: true, value: 10_000 });
    win.dispatchEvent(new Event("scroll"));
    await new Promise((done) => setTimeout(done, 0));
    expect(seen).toBe(true);
  });
});

describe("marked", () => {
  it("escapes ASCII and marks everything else with its code point", () => {
    expect(marked("a<b")).toBe("a&lt;b");
    expect(marked("é")).toBe('<mark title="U+00E9">é</mark>');
    expect(marked(undefined as unknown as string)).toBe("");
  });
});
