import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { launchLinks, listenForLinks, registerProtocolClient } from "./protocol-client.cjs";

function fakeApp(isPackaged: boolean) {
  return { isPackaged, setAsDefaultProtocolClient: vi.fn(() => true) };
}

describe("registerProtocolClient", () => {
  it("registers a packaged build with the plain call", () => {
    const app = fakeApp(true);
    expect(registerProtocolClient({ app, protocol: "weft", platform: "win32" })).toBe(true);
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("weft");
  });

  it("registers the dev Electron with the project folder on Windows", () => {
    const app = fakeApp(false);
    registerProtocolClient({ app, protocol: "weft", platform: "win32", argv: ["C:\\electron.exe", "."], execPath: "C:\\electron.exe" });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("weft", "C:\\electron.exe", [path.resolve(".")]);
  });

  it("registers the dev Electron on Linux too", () => {
    const app = fakeApp(false);
    registerProtocolClient({ app, protocol: "weft", platform: "linux", argv: ["/e", "/proj"], execPath: "/e" });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("weft", "/e", ["/proj"]);
  });

  it("leaves macOS dev to the Weft Dev.app wrapper", () => {
    const app = fakeApp(false);
    expect(registerProtocolClient({ app, protocol: "weft", platform: "darwin", argv: ["/e", "."] })).toBe(false);
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it("skips a dev run with no app path to relaunch", () => {
    const app = fakeApp(false);
    expect(registerProtocolClient({ app, protocol: "weft", platform: "win32", argv: ["/e"] })).toBe(false);
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });
});

describe("launchLinks", () => {
  it("queues the weft:// link Windows passed on launch", () => {
    expect(launchLinks(["C:\\Weft.exe", "weft://account-callback?code=abc"], "weft")).toEqual(["weft://account-callback?code=abc"]);
  });

  it("queues nothing for a plain launch", () => {
    expect(launchLinks(["C:\\Weft.exe"], "weft")).toEqual([]);
  });
});

describe("listenForLinks", () => {
  function listen() {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const app = { on: (name: string, fn: (...args: unknown[]) => void) => (handlers[name] = fn) };
    const showMain = vi.fn();
    const handleLink = vi.fn();
    listenForLinks({ app, protocol: "weft", showMain, handleLink });
    return { handlers, showMain, handleLink };
  }

  it("hands a second launch's link to handleLink and shows the window", () => {
    const { handlers, showMain, handleLink } = listen();
    handlers["second-instance"]({}, ["C:\\electron.exe", "C:\\weft", "weft://account-callback?code=abc"]);
    expect(showMain).toHaveBeenCalled();
    expect(handleLink).toHaveBeenCalledWith("weft://account-callback?code=abc");
  });

  it("only shows the window for a second launch with no link", () => {
    const { handlers, showMain, handleLink } = listen();
    handlers["second-instance"]({}, ["C:\\electron.exe"]);
    expect(showMain).toHaveBeenCalled();
    expect(handleLink).not.toHaveBeenCalled();
  });

  it("takes macOS open-url links and stops the default", () => {
    const { handlers, handleLink } = listen();
    const event = { preventDefault: vi.fn() };
    handlers["open-url"](event, "weft://card/1");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handleLink).toHaveBeenCalledWith("weft://card/1");
  });
});
