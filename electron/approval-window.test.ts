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

  it("lays a worker's run out command first, marks what isn't plain ASCII, and offers no Always", () => {
    const view = { ...base, command: "npm run jоb", script: "job: node job.js\npostjob: echo ok", thread: "Deploy <x>", why: "Ship it", worker: "m1<mini>", remote: "git@github.com:aimhuge/weft.git", fingerprint: "ab12 cd34 ef56 7890", firstUse: true };
    const html = approvalHtml(view, { touchId: true });
    expect(html).toContain("<title>Run a command with secrets on a worker?</title>");
    expect(html).toContain("A card on the worker <b>m1&lt;mini&gt;</b> wants to run this");
    // The Cyrillic о is marked and named.
    expect(html).toContain('npm run j<mark title="U+043E">о</mark>b');
    expect(html).toContain("job: node job.js\npostjob: echo ok");
    expect(html).toContain("git@github.com:aimhuge/weft.git");
    expect(html).toContain("ab12 cd34 ef56 7890 · first seen now, pinned from here on");
    expect(html).toContain("The command and any code it runs on m1&lt;mini&gt; get these values.");
    // The thread's words come after the command.
    expect(html.indexOf("Deploy &lt;x&gt;")).toBeGreaterThan(html.indexOf("npm run j"));
    expect(html.indexOf("Ship it")).toBeGreaterThan(html.indexOf("get these values"));
    expect(html).toContain("Allow once</button>");
    expect(html).toContain("Touch ID to allow once");
    expect(html).toContain("Scroll to the end to allow.");
    expect(html).not.toContain('data-answer="always"');
    expect(approvalHtml(base)).toContain('data-answer="always"');
    expect(approvalHtml(base)).toContain("window.__seen = Promise.resolve(true);");
    expect(approvalHtml({ ...view, fingerprint: "ab12", firstUse: false, script: undefined, thread: undefined, why: undefined, remote: undefined })).toContain("ab12 · pinned");
    expect(approvalHtml({ ...view, fingerprint: undefined })).not.toContain(">key<");
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

describe("askInWindow", () => {
  // A BrowserWindow stand-in: the page's __seen and __answer are promises the test settles.
  function fakeWindow(seen: Promise<unknown>, answer: Promise<unknown>) {
    const scripts: string[] = [];
    class Win {
      webContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: vi.fn((code: string) => {
          scripts.push(code);
          if (code === "window.__seen") return seen;
          if (code === "window.__answer") return answer;
          return Promise.resolve(code.includes("scrollHeight") ? 300 : undefined);
        }),
      };
      once = vi.fn();
      loadURL = vi.fn(() => Promise.resolve());
      setSize = vi.fn();
      center = vi.fn();
      show = vi.fn();
      focus = vi.fn();
      isDestroyed = () => false;
      destroy = vi.fn();
    }
    return { BrowserWindow: Win, scripts };
  }

  it("asks Touch ID only once the whole command has been on screen", async () => {
    const { askInWindow } = await import("./approval-window.cjs");
    let markSeen: (v: boolean) => void = () => {};
    const seen = new Promise<boolean>((done) => (markSeen = done));
    const touch = vi.fn(() => Promise.resolve(true));
    const { BrowserWindow } = fakeWindow(seen, new Promise(() => {}));
    const asked = askInWindow({ BrowserWindow, view: { ...base, worker: "m1mini" }, touchId: true, touch });
    await new Promise((done) => setTimeout(done, 5));
    expect(touch).not.toHaveBeenCalled();
    markSeen(true);
    expect(await asked).toBe("once");
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("never asks Touch ID when the window closes unseen", async () => {
    const { askInWindow } = await import("./approval-window.cjs");
    const touch = vi.fn(() => Promise.resolve(true));
    const { BrowserWindow } = fakeWindow(Promise.resolve(null), Promise.resolve(null));
    expect(await askInWindow({ BrowserWindow, view: { ...base, worker: "m1mini" }, touchId: true, touch })).toBeNull();
    expect(touch).not.toHaveBeenCalled();
  });
});
