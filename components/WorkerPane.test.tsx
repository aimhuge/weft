// @vitest-environment jsdom
// A worker card's pane column (components/WorkerPane.tsx): this Mac's native pane on a page the card wrote or a site,
// the web board's pane on the live screen (taps sent to the worker), on a page only the worker has, and off the
// desktop app, and the native pane again while Local Simulator runs the app here; the host chip switches between them.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const seen = new Map<string, Record<string, unknown>>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Record<string, unknown>) {
      seen.set(what, props);
      return null;
    },
}));
vi.mock("./web-board/WebPane", () => ({
  WebPane: (props: Record<string, unknown>) => {
    seen.set("web pane", props);
    return null;
  },
}));
const qa = vi.hoisted(() => ({ on: false }));
vi.mock("./use-local-simulator", () => ({ useLocalSimulator: () => ({ on: qa.on, ready: true, approved: null, devices: [], busy: false, problem: "", send: vi.fn() }) }));
vi.mock("./web-board/HostChip", () => ({
  HostChip: (props: Record<string, unknown>) => {
    seen.set("host chip", props);
    return null;
  },
}));
const sendWorkerAction = vi.hoisted(() => vi.fn(() => Promise.resolve({ commandId: "cmd-1" })));
vi.mock("@/lib/worker-transport", () => ({ sendWorkerAction }));

vi.mock("./SaveAppButton", () => ({
  default: (props: Record<string, unknown>) => {
    seen.set("save app", props);
    return null;
  },
}));

const { default: WorkerPane } = await import("./WorkerPane");

const card = { id: "w1", title: "App", cwd: "worker://m1/app", mobileApp: true } as Card;
const browser = { desktop: true, state: { url: "" } as never, obscured: false, width: 500, onWidth: vi.fn() };
const web = { ...browser, desktop: false };
const SHA = "a".repeat(64);
const open = vi.fn<(url: string, key?: string) => Promise<void>>(() => Promise.resolve());
Object.assign(window, { weft: { browser: { open } } });

afterEach(() => {
  cleanup();
  seen.clear();
  qa.on = false;
  open.mockClear();
});

describe("WorkerPane", () => {
  it("frames the page on show and sends taps on the live screen to the worker", async () => {
    const onClose = vi.fn();
    render(<WorkerPane card={card} worker={{ name: "m1mini", status: "online" }} url={`blob:sha256:${"a".repeat(64)}`} browser={web} marks={null} onClose={onClose} />);
    const pane = seen.get("web pane")!;
    expect(pane.pane).toMatchObject({ kind: "blob" });
    expect(pane.source).toBe("m1mini");
    expect(pane.mobileApp).toBe(true);
    expect(pane.onClose).toBe(onClose);
    expect(pane.local).toMatchObject({ on: false });
    await (pane.onScreenInput as (input: unknown) => Promise<void>)({ kind: "watch" });
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "input", cardId: "w1", input: { kind: "watch" } });
  });

  it("offers Save as app on a page the card wrote, and not on anything else", () => {
    const url = `blob:sha256:${"a".repeat(64)}`;
    const { rerender } = render(<WorkerPane card={card} url={url} browser={web} marks={null} onClose={vi.fn()} />);
    render(<>{seen.get("web pane")!.actions as React.ReactNode}</>);
    expect(seen.get("save app")).toEqual({ url, title: "App" });
    seen.clear();
    rerender(<WorkerPane card={card} url="https://example.com" browser={web} marks={null} onClose={vi.fn()} />);
    render(<>{seen.get("web pane")!.actions as React.ReactNode}</>);
    expect(seen.has("save app")).toBe(false);
  });

  it("is this Mac's native pane while Local Simulator runs the app here", () => {
    qa.on = true;
    render(<WorkerPane card={card} url={`blob:sha256:${SHA}`} browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.has("web pane")).toBe(false);
    expect(seen.get("browser pane")).toMatchObject({ expanded: true, desktop: true });
    // The pane is on the app's live view here, not the card's page.
    expect(open).not.toHaveBeenCalled();
    render(<>{seen.get("browser pane")!.actions as React.ReactNode}</>);
    expect(seen.get("host chip")).toMatchObject({ local: { on: true } });
    expect(seen.get("host chip")!.onScreenInput).toBeUndefined();
    expect(seen.get("save app")).toEqual({ url: `blob:sha256:${SHA}`, title: "App" });
  });

  it("names no worker when it doesn't know which", () => {
    render(<WorkerPane card={card} url="" browser={web} marks={null} onClose={vi.fn()} />);
    expect(seen.get("web pane")!.source).toBeUndefined();
    expect(seen.get("web pane")!.pane).toBeNull();
  });

  it("loads a page the card wrote in the native pane, through this Mac's server, and saves it by its blob ref", async () => {
    const page = `${window.location.origin}/api/worker-board/page/${SHA}#two`;
    const state = { url: page } as never;
    render(<WorkerPane card={card} worker={{ name: "m1mini", status: "online" }} url={`blob:sha256:${SHA}#two`} browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.has("web pane")).toBe(false);
    expect(seen.get("browser pane")).toMatchObject({ expanded: true, desktop: true, saveUrl: "" });
    expect(open).toHaveBeenCalledWith(page, "w1");
    cleanup();
    open.mockClear();
    // Reopened on the page its pane already shows: nothing reloads, and Save as app saves the blob.
    render(<WorkerPane card={card} url={`blob:sha256:${SHA}#two`} browser={{ ...browser, state }} marks={null} onClose={vi.fn()} />);
    expect(open).not.toHaveBeenCalled();
    expect(seen.get("browser pane")!.saveUrl).toBe(`blob:sha256:${SHA}#two`);
    render(<>{seen.get("browser pane")!.actions as React.ReactNode}</>);
    expect(seen.has("save app")).toBe(false);
    expect(seen.get("host chip")).toMatchObject({ worker: undefined, mobileApp: true, local: { on: false } });
    await (seen.get("host chip")!.onScreenInput as (input: unknown) => Promise<void>)({ kind: "watch" });
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "input", cardId: "w1", input: { kind: "watch" } });
  });

  it("loads a site in the native pane as it is", () => {
    render(<WorkerPane card={card} url="https://example.com/a" browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.has("browser pane")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "w1");
  });

  it("keeps the web board's pane for the live screen and a page only the worker has", () => {
    render(<WorkerPane card={card} url="http://localhost:3000/" browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.get("web pane")!.pane).toMatchObject({ kind: "local" });
    expect(seen.has("browser pane")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
