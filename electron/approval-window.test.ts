import { describe, expect, it, vi } from "vitest";
import { approvalHtml, settle } from "./approval-window.cjs";

const base = { command: "node send.js", cwd: "/p", names: ["K"], environment: "development", label: "o/r" };

describe("approvalHtml", () => {
  it("names the asking card and quotes its reason, escaped", () => {
    const html = approvalHtml({ ...base, thread: "Mail <forwarding>", why: "Send a <b>test</b> email" });
    expect(html).toContain('<b class="thread">Mail &lt;forwarding&gt;</b> wants to run this');
    expect(html).toContain('<div class="why"><div class="label">Why</div><p>Send a &lt;b&gt;test&lt;/b&gt; email</p></div>');
  });

  it("falls back to 'A thread' and no Why block without them", () => {
    const html = approvalHtml(base);
    expect(html).toContain("A thread wants to run this");
    expect(html).not.toContain('class="why"');
  });

  it("names the card whose dev server it is", () => {
    expect(approvalHtml({ ...base, kind: "dev", thread: "Site" })).toContain(`<b class="thread">Site</b>'s dev server gets`);
    expect(approvalHtml({ ...base, kind: "dev" })).toContain("This card's dev server gets");
  });
});

describe("settle", () => {
  const never = new Promise<never>(() => {});
  const touchOk = () => Promise.resolve(true);

  it("allows once on a touch alone, without a click", async () => {
    expect(await settle(never, Promise.resolve(true))).toBe("once");
  });

  it("waits for the same touch after a click, and cancels when it fails", async () => {
    expect(await settle(Promise.resolve("always"), new Promise((r) => setTimeout(() => r(true), 5)))).toBe("always");
    expect(await settle(Promise.resolve("once"), new Promise((r) => setTimeout(() => r(false), 5)))).toBeNull();
    expect(await settle(Promise.resolve(null), never)).toBeNull();
  });

  it("leaves the buttons after a cancelled prompt and asks Touch ID again on the click", async () => {
    let click: (v: string | null) => void = () => {};
    const answer = new Promise<string | null>((r) => (click = r));
    const ended = vi.fn();
    const touch = vi.fn(touchOk);
    const result = settle(answer, Promise.resolve(false), touch, ended);
    await new Promise((r) => setTimeout(r, 0));
    expect(ended).toHaveBeenCalled();
    click("always");
    expect(await result).toBe("always");
    expect(touch).toHaveBeenCalledTimes(1);
    expect(await settle(Promise.resolve("once"), Promise.resolve(false), () => Promise.resolve(false))).toBeNull();
  });

  it("takes the click as is without Touch ID", async () => {
    expect(await settle(Promise.resolve("always"), null)).toBe("always");
    expect(await settle(Promise.resolve("nope"), null)).toBeNull();
  });
});

describe("approvalHtml's Touch ID hint", () => {
  it("shows only where the Mac has Touch ID", () => {
    expect(approvalHtml(base, { touchId: true })).toContain("Touch ID to allow for 1 hour");
    expect(approvalHtml(base)).not.toContain("Touch ID to allow for 1 hour");
  });
});
