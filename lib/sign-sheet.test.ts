// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { passkeyMessage, readPasskeyMessage, type PasskeyMessage } from "./approval-passkey";
import type { SignAsk } from "./sign-approve";
import { showNote, showSheet } from "./sign-sheet";

function ask(input: Record<string, unknown>): SignAsk {
  const message = passkeyMessage({ orgId: "o", macDevice: "mac-1", cardId: "c1", pendingId: "p1", allow: true, issuedAt: 7 }, { toolName: "Bash", input, folder: "/w/app" });
  return { row: {} as never, approval: { message, device: "b", credId: "c", issuedAt: 7 }, signed: readPasskeyMessage(message) as PasskeyMessage };
}

const root = () => document.createElement("main");
const button = (r: HTMLElement, name: string) => [...r.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;
// jsdom lays nothing out: give the input box a size, as a browser would.
function size(pre: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(pre, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(pre, "clientHeight", { value: clientHeight, configurable: true });
}

describe("showSheet", () => {
  it("shows the decision, tool, folder, card, size and the whole input, with hidden characters marked", () => {
    const r = root();
    showSheet(r, ask({ command: `ls‮${" ".repeat(40)}x`, content: "a\nb" }), { sign: vi.fn(), cancel: vi.fn() });
    expect(r.textContent).toContain("Allow Bash");
    expect(r.textContent).toContain("In /w/app · card c1");
    expect(r.textContent).toMatch(/\d+ bytes, 4 lines/);
    const pre = r.querySelector("pre") as HTMLElement;
    expect(pre.getAttribute("aria-label")).toBe("Everything it signs");
    expect([...pre.querySelectorAll(".mark")].map((m) => m.textContent)).toEqual(["⟦U+202E⟧", "⟦40 spaces⟧"]);
    expect(pre.textContent).toContain('"content": "a\\nb"');
  });

  it("keeps Allow off until a long input is scrolled to its end, then signs", async () => {
    const r = root();
    const sign = vi.fn().mockResolvedValueOnce("Touch ID was cancelled").mockResolvedValueOnce(null);
    showSheet(r, ask({ command: "x" }), { sign, cancel: vi.fn() });
    const pre = r.querySelector("pre") as HTMLElement;
    size(pre, 1000, 200);
    pre.dispatchEvent(new Event("scroll"));
    const allow = button(r, "Allow with Touch ID");
    expect(allow.disabled).toBe(true);
    expect(r.textContent).toContain("Scroll to the end");
    pre.scrollTop = 800;
    pre.dispatchEvent(new Event("scroll"));
    expect(allow.disabled).toBe(false);
    allow.click();
    expect(allow.textContent).toBe("Waiting for Touch ID…");
    await vi.waitFor(() => expect(r.querySelector("[role=alert]")?.textContent).toBe("Touch ID was cancelled"));
    expect(allow.disabled).toBe(false);
    allow.click();
    await vi.waitFor(() => expect(sign).toHaveBeenCalledTimes(2));
  });

  it("cancels", () => {
    const r = root();
    const cancel = vi.fn();
    showSheet(r, ask({ command: "x" }), { sign: vi.fn(), cancel });
    button(r, "Cancel").click();
    expect(cancel).toHaveBeenCalled();
  });

  it("names an unnamed folder", () => {
    const r = root();
    const plain = ask({ command: "x" });
    showSheet(r, { ...plain, signed: { ...plain.signed, folder: null, decision: "deny" } }, { sign: vi.fn(), cancel: vi.fn() });
    expect(r.textContent).toContain("Deny Bash");
    expect(r.textContent).toContain("In an unnamed folder");
  });
});

describe("showNote", () => {
  it("draws a title and one line, plain or as a warning", () => {
    const r = root();
    showNote(r, "Sent", "Done.");
    expect(r.querySelector("p")?.className).toBe("muted");
    showNote(r, "No", "Refused.", true);
    expect(r.querySelector("h1")?.textContent).toBe("No");
    expect(r.querySelector("p")?.className).toBe("warn");
  });
});
