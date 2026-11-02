// @vitest-environment jsdom
// A worker card's pane column (components/WorkerPane.tsx): the web board's pane on the page on show, with taps on its
// live screen sent to the worker, or this Mac's native pane while Local Simulator runs the app here; the host chip
// switches between them.
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

afterEach(() => {
  cleanup();
  seen.clear();
  qa.on = false;
});

describe("WorkerPane", () => {
  it("frames the page on show and sends taps on the live screen to the worker", async () => {
    const onClose = vi.fn();
    render(<WorkerPane card={card} worker={{ name: "m1mini", status: "online" }} url={`blob:sha256:${"a".repeat(64)}`} browser={browser} marks={null} onClose={onClose} />);
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
    const { rerender } = render(<WorkerPane card={card} url={url} browser={browser} marks={null} onClose={vi.fn()} />);
    render(<>{seen.get("web pane")!.actions as React.ReactNode}</>);
    expect(seen.get("save app")).toEqual({ url, title: "App" });
    seen.clear();
    rerender(<WorkerPane card={card} url="https://example.com" browser={browser} marks={null} onClose={vi.fn()} />);
    render(<>{seen.get("web pane")!.actions as React.ReactNode}</>);
    expect(seen.has("save app")).toBe(false);
  });

  it("is this Mac's native pane while Local Simulator runs the app here", () => {
    qa.on = true;
    render(<WorkerPane card={card} url="" browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.has("web pane")).toBe(false);
    expect(seen.get("browser pane")).toMatchObject({ expanded: true, desktop: true });
    render(<>{seen.get("browser pane")!.actions as React.ReactNode}</>);
    expect(seen.get("host chip")).toMatchObject({ local: { on: true } });
  });

  it("names no worker when it doesn't know which", () => {
    render(<WorkerPane card={card} url="" browser={browser} marks={null} onClose={vi.fn()} />);
    expect(seen.get("web pane")!.source).toBeUndefined();
    expect(seen.get("web pane")!.pane).toBeNull();
  });
});
