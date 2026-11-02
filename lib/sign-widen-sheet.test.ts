// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showWidenSheet } from "./sign-widen-sheet";
import type { WidenToSign } from "./sign-widen";

const w = (device = "worker:w1") =>
  ({ target: { orgId: "o", device, folder: "app", cardId: "c1" }, verb: "card.shell", args: {}, host: device.replace("worker:", ""), change: { shell: "ls​" }, message: "m", device: "b", credId: "c", issuedAt: 1, nonce: "n" }) as WidenToSign;

describe("showWidenSheet", () => {
  it("shows the change, the card and the host, marks invisible characters, and signs on Approve", async () => {
    const root = document.createElement("div");
    const sign = vi.fn(() => Promise.resolve("try again"));
    const cancel = vi.fn();
    showWidenSheet(root, w(), { sign, cancel });
    expect(root.textContent).toContain("run the shell command ls");
    expect(root.textContent).toContain("card c1 · on worker w1");
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
