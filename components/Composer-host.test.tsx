// @vitest-environment jsdom
// The composer on a worker's card (components/Composer.tsx inside lib/worker-transport.ts): typing "/" lists the
// skills the worker finds for the card's checkout, asked as a skills.list host command, not this Mac's /api/skills.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { forgetWorkerSkills, workerTransport } from "@/lib/worker-transport";
import "./test-utils";
import Composer from "./Composer";

const api = vi.hoisted(() => ({ skills: vi.fn(() => Promise.resolve({ skills: [{ name: "mac-only", description: "", source: "user" }] })) }));
vi.mock("@/lib/client", () => ({ api }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock("@/lib/api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

// ProseMirror measures the cursor to scroll it into view; jsdom has no layout, so nothing to measure.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const WORKER_LIST = { ok: true, cardId: "w-card", skills: [["deploy-worker", "Deploys from the worker", "project"]] };

beforeEach(() => {
  forgetWorkerSkills();
  fetchMock.mockImplementation((url) =>
    Promise.resolve(url.startsWith("/api/workers?command=") ? json({ status: "done", error: null, result: WORKER_LIST }) : json({ commandId: "cmd-1" })),
  );
});
afterEach(() => vi.clearAllMocks());

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);

describe("the composer on a worker's card", () => {
  it("offers the worker's skills for \"/\", asked of the worker for that card", async () => {
    render(
      <ThreadTransportContext.Provider value={workerTransport}>
        <Composer variant="reply" initial="/de" autoFocus placeholder="Reply…" sizeClass="" onSubmit={() => {}} cwd="worker://w1/app" cardId="w-card" />
      </ThreadTransportContext.Provider>,
    );
    const list = await screen.findByRole("listbox", { name: "Skills" });
    expect(list).toHaveTextContent("deploy-worker");
    expect(list).not.toHaveTextContent("mac-only");
    expect(posts()).toEqual([{ action: "host", cardId: "w-card", verb: "skills.list", args: { id: "w-card" } }]);
    expect(api.skills).not.toHaveBeenCalled();
  });

  it("still lists this Mac's skills for a local card, from /api/skills as before", async () => {
    render(<Composer variant="reply" initial="/ma" autoFocus placeholder="Reply…" sizeClass="" onSubmit={() => {}} cwd="/dev/app" cardId="c1" />);
    await waitFor(() => expect(api.skills).toHaveBeenCalledWith("/dev/app"));
    expect(await screen.findByRole("listbox", { name: "Skills" })).toHaveTextContent("mac-only");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
