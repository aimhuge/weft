// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showWidenSheet } from "./sign-widen-sheet";
import type { WidenToSign } from "./sign-widen";

const w = (device = "worker:w1") =>
  ({ target: { orgId: "o", device, folder: "app", cardId: "c1" }, verb: "card.shell", args: { command: "ls\u200b", id: "c1" }, host: device.replace("worker:", ""), change: { shell: "ls​" }, message: "m", device: "b", credId: "c", issuedAt: 1, nonce: "n" }) as WidenToSign;

describe("showWidenSheet", () => {
  it("shows the change, the card and the host, marks invisible characters, and signs on Approve", async () => {
    const root = document.createElement("div");
    const sign = vi.fn(() => Promise.resolve("try again"));
    const cancel = vi.fn();
    showWidenSheet(root, w(), { sign, cancel });
    expect(root.textContent).toContain("run the shell command ls");
    expect(root.textContent).toContain("card c1 · on worker w1");
    // What it sends is shown whole, without the card id, which the line above names.
    expect(root.querySelector("pre")?.textContent).toContain('"command": "ls⟦U+200B⟧"');
    expect(root.querySelector("pre")?.textContent).not.toContain('"id"');
    expect(root.querySelector(".mark")).not.toBeNull();
    const [no, yes] = [...root.querySelectorAll("button")];
    yes?.click();
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe("try again"));
    sign.mockResolvedValueOnce(null as never);
    yes?.click();
    await vi.waitFor(() => expect(sign).toHaveBeenCalledTimes(2));
    no?.click();
    expect(cancel).toHaveBeenCalled();
    const pre = root.querySelector("pre") as HTMLElement;
    pre.dispatchEvent(new Event("scroll"));
  });

  it("names a Mac by its device id", () => {
    const root = document.createElement("div");
    showWidenSheet(root, w("abcdef0123456789"), { sign: vi.fn(), cancel: vi.fn() });
    expect(root.textContent).toContain("on Mac abcdef012345");
  });
});

describe("showWidenSheet with the card it read", () => {
  it("names the card by its title and folder, and a \"!\" line's send-at time", () => {
    const root = document.createElement("div");
    const sheet = { ...w(), verb: "card.schedule", change: { schedule: "!ls" }, args: { text: "!ls", at: 0, id: "c1" }, card: { title: "Fix login", folder: "app" } } as WidenToSign;
    showWidenSheet(root, sheet, { sign: vi.fn(), cancel: vi.fn() });
    expect(root.textContent).toContain("“Fix login” in app · on worker w1 · sent ");
  });
});
