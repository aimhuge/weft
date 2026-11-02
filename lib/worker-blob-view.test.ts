// @vitest-environment jsdom
// A worker card's pictures (lib/worker-blob-view.ts): the blob refs its thread names for images, signed through this
// Mac's server and drawn once they land, while page refs stay refs and the rail gets the items as they came.
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url) }));

const { forgetBlobUrls, imageRefs, requestBlobUrls, URL_TTL_MS, useWorkerView, withImageUrls } = await import("./worker-blob-view");
const { clearShown, useWorkerShown } = await import("./worker-shown");

const ref = (c: string) => `blob:sha256:${c.repeat(64)}`;
const A = ref("a");
const B = ref("b");
const P = ref("c");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const signed = (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `https://sb.test/storage/v1/object/sign/weft-blobs/o/${r.slice(-4)}`]));
const asked = (url: string) => new URL(url, "http://x").searchParams.get("blobs")!.split(",");

const thread: ThreadItem[] = [
  { kind: "user", text: `look ![shot](${A}) and ![spaced](<${B}>)`, at: 1, page: `${P}#top` },
  { kind: "tool", id: "t1", name: "mcp__browser__screenshot", summary: "", images: [A, "https://x.test/p.png"], at: 2 },
  { kind: "tool", id: "t2", name: "mcp__browser__open_url", summary: `${P}#top`, at: 3 },
  { kind: "edited", items: [{ kind: "assistant", text: `![again](${B})`, at: 4 }, { kind: "result", text: "", isError: false, at: 4 }], at: 4 },
  { kind: "result", text: "", isError: false, at: 5 },
];

beforeEach(() => {
  forgetBlobUrls();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url) => Promise.resolve(json({ urls: signed(asked(url)) })));
});

afterEach(() => act(() => clearShown()));

describe("imageRefs and withImageUrls", () => {
  it("finds the picture refs, once each, and not a page's", () => {
    expect(imageRefs(thread)).toEqual([A, B]);
  });

  it("draws each picture from its URL, leaves page refs and unsigned refs alone, and keeps untouched items", () => {
    const urls = { [A]: "https://u/a" };
    const out = withImageUrls(thread, urls);
    expect(out[0]).toMatchObject({ text: `look ![shot](https://u/a) and ![spaced](<${B}>)`, page: `${P}#top` });
    expect(out[1]).toMatchObject({ images: ["https://u/a", "https://x.test/p.png"] });
    expect(out[2]).toBe(thread[2]);
    expect(out[3]).toBe(thread[3]);
    expect(withImageUrls(thread, { [B]: "https://u/b" })[3]).toEqual({ kind: "edited", items: [{ kind: "assistant", text: "![again](https://u/b)", at: 4 }, { kind: "result", text: "", isError: false, at: 4 }], at: 4 });
  });

  it("is the same list when nothing has a URL", () => {
    expect(withImageUrls(thread, {})).toBe(thread);
    const tool: ThreadItem = { kind: "tool", id: "t", name: "Bash", summary: "", at: 0 };
    expect(withImageUrls([tool], { [A]: "u" })[0]).toBe(tool);
  });
});

describe("requestBlobUrls", () => {
  it("asks once for refs it has, again once their URLs are old, and in batches of 50", async () => {
    await requestBlobUrls([A, B], 1000);
    await requestBlobUrls([A, B], 2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await requestBlobUrls([A], 1000 + URL_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const many = Array.from({ length: 60 }, (_, i) => `blob:sha256:${i.toString(16).padStart(64, "0")}`);
    await requestBlobUrls(many, 0);
    expect(fetchMock.mock.calls.slice(2).map(([url]) => asked(url).length)).toEqual([50, 10]);
  });

  it("asks again after a refusal, a failed fetch or an answer with nothing signed", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "no" }, 502));
    await requestBlobUrls([A], 0);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await requestBlobUrls([A], 0);
    fetchMock.mockResolvedValueOnce(json({}));
    await requestBlobUrls([A], 0);
    await requestBlobUrls([A], 0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("doesn't ask twice for a ref already on its way", async () => {
    const first = requestBlobUrls([A], 0);
    await requestBlobUrls([A], 0);
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useWorkerView", () => {
  it("draws the pictures once their URLs land, and hands the rail the items as they came", async () => {
    const rail = renderHook(() => useWorkerShown());
    const { result, unmount } = renderHook(() => useWorkerView(thread));
    expect(rail.result.current).toBe(thread);
    await waitFor(() => expect((result.current[0] as { text: string }).text).toContain("https://sb.test/"));
    expect((result.current[1] as { images: string[] }).images[0]).toContain("https://sb.test/");
    expect(rail.result.current).toBe(thread);
    unmount();
    rail.unmount();
  });

  it("renders on the server with the items as they are", () => {
    function View() {
      return createElement("p", null, (useWorkerView(thread)[0] as { text: string }).text);
    }
    expect(renderToString(createElement(View))).toContain(A);
  });

  it("asks for nothing when the thread has no pictures", () => {
    const items: ThreadItem[] = [{ kind: "assistant", text: "plain", at: 0 }];
    expect(renderHook(() => useWorkerView(items)).result.current).toBe(items);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
