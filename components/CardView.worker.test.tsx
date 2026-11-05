// @vitest-environment jsdom
// A worker's card as a tile on the desktop board (components/CardView.tsx): no longer read-only. Its buttons act through
// its host (lib/project-host.ts), and what only this Mac could do (logging this Mac's CLI in) stays off it.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forget } from "@/lib/optimistic-cards";
import { makeCard } from "./test-utils";
import CardView from "./CardView";

const api = vi.hoisted(() => ({ login: vi.fn(), switchBackend: vi.fn(), waitPermission: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock("@/lib/api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const worker = (over: Parameters<typeof makeCard>[0] = {}) => makeCard({ cwd: "worker://w1/ling", ...over });
const hostSent = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === "/api/worker-board" && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  fetchMock.mockImplementation((url) => Promise.resolve(json(url.startsWith("/api/workers") ? { status: "done", error: null } : { commandId: "cmd-1" })));
});

afterEach(() => {
  forget("c1");
  vi.clearAllMocks();
});

describe("a worker card's tile", () => {
  it("can be dragged, starred and stopped like any card", async () => {
    const onStar = vi.fn();
    const onStop = vi.fn();
    const { container } = render(<CardView card={worker({ column: "needs_you", sessionId: "s1", lastLine: "Bash: ls" })} now={0} selected={false} onOpen={vi.fn()} onStar={onStar} onStop={onStop} />);
    expect(container.querySelector("[draggable=true]")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /star/i }));
    expect(onStar).toHaveBeenCalled();
  });

  it("asks its worker to hold a held edit, not this Mac", async () => {
    const why = { holder: { id: "c2", title: "Other", claim: "f.ts" } } as never;
    render(<CardView card={worker({ column: "needs_you", pending: { id: "p1", toolName: "Edit", title: "Edit f.ts", input: {}, why } })} now={0} selected={false} onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Wait" }));
    await settle();
    expect(hostSent()).toEqual([{ action: "host", cardId: "c1", verb: "card.permission.wait", args: { id: "c1", pendingId: "p1" } }]);
    expect(api.waitPermission).not.toHaveBeenCalled();
  });

  it("runs a rate-limited card on the other CLI through its worker", async () => {
    render(<CardView card={worker({ column: "review", rateLimitHit: true, error: "limit" })} now={0} selected={false} onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Run on puku-cli" }));
    await settle();
    expect(hostSent()).toEqual([{ action: "host", cardId: "c1", verb: "card.switchBackend", args: { id: "c1", backend: "puku", replay: true } }]);
    expect(api.switchBackend).not.toHaveBeenCalled();
  });

  it("doesn't offer to log this Mac's CLI in for a card on a worker", () => {
    render(<CardView card={worker({ column: "needs_you", lastLine: "Log in to Claude Code" })} now={0} selected={false} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });
});
