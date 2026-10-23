// @vitest-environment jsdom
// components/share-view/use-app-bridge.ts: the parent side of the hosted-app bridge
// (lib/app-bridge.ts). The listener accepts a MessageEvent only when event.source is the
// iframe's contentWindow; everything else is dropped. Each parsed BridgeRequest is answered
// with one BridgeResponse back through iframe.contentWindow.postMessage(...), with targetOrigin
// "*" because the frame's origin is opaque. Fetch, read, env and requestSecret go to the right
// /api/a/<id>/{fetch,read,env} route, and a renderSecretForm call resolves the requestSecret call.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_TAG } from "@/lib/app-bridge";
import { useAppBridge } from "./use-app-bridge";

// A host that mounts the hook with a fake iframe ref. The hook grabs window as the iframe's
// contentWindow so the test can post messages from "the frame" to itself.
type RenderSecretForm = (input: { shareId: string; name: string; hosts: string[]; onDone: (set: boolean) => void }) => void;
function Host({
  shareId,
  secrets,
  renderSecretForm,
  frameRef,
}: {
  shareId: string;
  secrets: { name: string; hosts: string[] }[];
  renderSecretForm: RenderSecretForm;
  frameRef: { current: HTMLIFrameElement | null };
}) {
  useAppBridge(frameRef, { shareId, secrets, renderSecretForm });
  return <div data-testid="host" />;
}

interface Frame extends Window {
  __postCalls: { data: unknown; origin: string }[];
}

function postFrom(frame: Frame, data: unknown, source: Window | null = frame) {
  // A MessageEvent's source defaults to null in jsdom for safety; the hook reads it as-is, so the
  // test sets it to the iframe's contentWindow itself.
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The default fetch is happy; each test sets its own to assert on the route paths.
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAppBridge", () => {
  it("rebinds when the iframe's src changes so messages from the new contentWindow are answered", async () => {
    // A fresh Response per call so the route's body read succeeds twice (the default mockResponse
    // is consumed on the first .json() and the second call would fail with "Body has already been
    // read").
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(
      () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    // The first frame: we mount it, answer one message from its window, then replace its
    // contentWindow by setting a new src. jsdom replaces the iframe's contentWindow when load fires
    // after a src change; we replace it ourselves to exercise the post-navigation read.
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const firstWindow = fakeFrame.contentWindow;
    const firstSpy = vi.spyOn(firstWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(firstWindow as Frame, { tag: BRIDGE_TAG, id: 1, op: "env" }, firstWindow);
      await Promise.resolve();
    });
    expect(firstSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 1, ok: true }), "*");
    // The post-navigation contentWindow: a plain object shaped like Window, with postMessage so we
    // can spy on the response. The hook only touches postMessage on the live contentWindow.
    const secondWindow: Window = { postMessage: () => {} } as unknown as Window;
    Object.defineProperty(fakeFrame, "contentWindow", { value: secondWindow, configurable: true });
    const secondSpy = vi.spyOn(secondWindow, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(secondWindow as Frame, { tag: BRIDGE_TAG, id: 2, op: "env" }, secondWindow);
      await Promise.resolve();
    });
    expect(secondSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 2, ok: true }), "*");
    // A message from the *old* contentWindow — even though the listener is still bound — must be
    // dropped, because the live iframeRef.current.contentWindow now points at secondWindow.
    firstSpy.mockClear();
    postFrom(firstWindow as Frame, { tag: BRIDGE_TAG, id: 3, op: "env" }, firstWindow);
    expect(firstSpy).not.toHaveBeenCalled();
  });
  it("ignores messages from windows that are not the iframe's contentWindow", () => {
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage");
    // A message whose source is the parent window, not the frame.
    const event = new MessageEvent("message", { data: { tag: BRIDGE_TAG, id: 1, op: "env" } });
    Object.defineProperty(event, "source", { value: window });
    window.dispatchEvent(event);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("ignores messages whose data isn't a parsed BridgeRequest", () => {
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage");
    postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: "not-weft", id: 1, op: "env" }, fakeFrame.contentWindow);
    postFrom(fakeFrame.contentWindow as unknown as Frame, { not: "an object" }, fakeFrame.contentWindow);
    postFrom(fakeFrame.contentWindow as unknown as Frame, null, fakeFrame.contentWindow);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("forwards env to GET /api/a/<id>/env and answers with the result", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ SUPABASE_PUBLISHABLE_KEY: "x" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 1, op: "env" }, fakeFrame.contentWindow);
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/a/s1/env", { credentials: "same-origin" });
    expect(postSpy).toHaveBeenCalledWith({ tag: BRIDGE_TAG, id: 1, ok: true, result: { SUPABASE_PUBLISHABLE_KEY: "x" } }, "*");
  });

  it("forwards access to GET /api/a/<id>/access and answers with the result", async () => {
    const info = { project: "Growth", env: "production", needs: [], missing: [], granted: true };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(info), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 2, op: "access" }, fakeFrame.contentWindow);
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/a/s1/access", { credentials: "same-origin" });
    expect(postSpy).toHaveBeenCalledWith({ tag: BRIDGE_TAG, id: 2, ok: true, result: info }, "*");
  });

  it("forwards fetch to POST /api/a/<id>/fetch with the AppFetchRequest as JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: 200, ok: true, headers: {}, body: "x", bodyEncoding: "utf8" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(
        fakeFrame.contentWindow as unknown as Frame,
        { tag: BRIDGE_TAG, id: 2, op: "fetch", url: "https://api.example.com/v1/charges", method: "GET", headers: { Authorization: "Bearer t" } },
        fakeFrame.contentWindow,
      );
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/a/s1/fetch",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ tag: BRIDGE_TAG, op: "fetch", url: "https://api.example.com/v1/charges", method: "GET", headers: { Authorization: "Bearer t" } }),
      }),
    );
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 2, ok: true }), "*");
  });

  it("forwards read to POST /api/a/<id>/read with { name, args }", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ rows: [1, 2, 3] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 3, op: "read", name: "signups", args: { days: 30 } }, fakeFrame.contentWindow);
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/a/s1/read",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "signups", args: { days: 30 } }) }),
    );
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 3, ok: true, result: { rows: [1, 2, 3] } }), "*");
  });

  it("renders the secret form and answers with { set } when the form calls onDone", async () => {
    const renderSecretForm = vi.fn(({ onDone }: { onDone: (set: boolean) => void }) => {
      // The form resolves immediately, mimicking a user click on Save.
      queueMicrotask(() => onDone(true));
    });
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(
      <Host
        shareId="s1"
        secrets={[{ name: "STRIPE_KEY", hosts: ["api.stripe.com"] }]}
        renderSecretForm={renderSecretForm}
        frameRef={frameRef}
      />,
    );
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 4, op: "requestSecret", name: "STRIPE_KEY" }, fakeFrame.contentWindow);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderSecretForm).toHaveBeenCalledWith(expect.objectContaining({ name: "STRIPE_KEY", hosts: ["api.stripe.com"], shareId: "s1" }));
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 4, ok: true, result: { set: true } }), "*");
  });

  it("answers with { ok: false, error } when the route fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } }),
    );
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="s1" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 5, op: "env" }, fakeFrame.contentWindow);
      await Promise.resolve();
    });
    expect(postSpy).toHaveBeenCalledWith({ tag: BRIDGE_TAG, id: 5, ok: false, error: "forbidden" }, "*");
  });

  it("does not attach a listener when shareId is empty", () => {
    const frameRef: { current: HTMLIFrameElement | null } = { current: null };
    render(<Host shareId="" secrets={[]} renderSecretForm={vi.fn()} frameRef={frameRef} />);
    const fakeFrame = document.createElement("iframe");
    document.body.appendChild(fakeFrame);
    frameRef.current = fakeFrame;
    const postSpy = vi.spyOn(fakeFrame.contentWindow!, "postMessage").mockImplementation(() => {});
    postFrom(fakeFrame.contentWindow as unknown as Frame, { tag: BRIDGE_TAG, id: 1, op: "env" }, fakeFrame.contentWindow);
    expect(postSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
