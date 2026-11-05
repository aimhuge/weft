// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { printerNames, printHtml } from "./print-sheet";

afterEach(() => {
  delete (window as { weft?: unknown }).weft;
  document.body.innerHTML = "";
});

const shell = (print: unknown) => Object.assign(window, { weft: { print } });

describe("printerNames", () => {
  it("is empty on the web and in an older shell", async () => {
    expect(await printerNames()).toEqual([]);
    shell(undefined);
    expect(await printerNames()).toEqual([]);
  });
  it("asks main for the Mac's printers", async () => {
    shell({ printers: () => Promise.resolve(["Office"]) });
    expect(await printerNames()).toEqual(["Office"]);
  });
  it("is empty when main can't tell", async () => {
    shell({ printers: () => Promise.reject(new Error("no")) });
    expect(await printerNames()).toEqual([]);
  });
});

describe("printHtml", () => {
  it("prints from Electron main on desktop", async () => {
    const html = vi.fn(() => Promise.resolve({ ok: true }));
    shell({ html });
    await printHtml("<p>sheet</p>");
    expect(html).toHaveBeenCalledWith("<p>sheet</p>");
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("prints from a hidden iframe on the web and removes it after", async () => {
    await printHtml("<p>sheet</p>");
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.srcdoc).toBe("<p>sheet</p>");
    const win = frame.contentWindow as Window;
    const print = vi.spyOn(win, "print").mockImplementation(() => {});
    frame.onload?.(new Event("load"));
    expect(print).toHaveBeenCalled();
    win.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector("iframe")).toBeNull();
  });
});
