// @vitest-environment jsdom
// A teammate's ask for one of your cards (lib/handover.ts): Hand it over or Not now.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import HandoverAskBar, { answer } from "./HandoverAskBar";

const m = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: m.apiFetch }));

const card = { ...makeCard({ id: "c1" }), handoverAsk: { id: "h1", org: "org", name: "Alex", at: "t" } };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => m.apiFetch.mockReset());
afterEach(cleanup);

describe("answer", () => {
  it("posts the card and the answer", async () => {
    m.apiFetch.mockResolvedValue(reply(200, { branch: "b" }));
    expect(await answer("c1", true)).toEqual({ branch: "b" });
    const [url, init] = m.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/handover");
    expect(JSON.parse(init.body as string)).toEqual({ card: "c1", yes: true });
  });

  it("throws the server's reason, or a plain one", async () => {
    m.apiFetch.mockResolvedValueOnce(reply(400, { error: "Couldn't push" }));
    await expect(answer("c1", true)).rejects.toThrow("Couldn't push");
    m.apiFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new Error("x")) });
    await expect(answer("c1", false)).rejects.toThrow("Couldn't answer that.");
  });
});

describe("HandoverAskBar", () => {
  it("says who asks, and hands it over", async () => {
    m.apiFetch.mockResolvedValue(reply(200, { branch: "weft/handover/c1" }));
    render(<HandoverAskBar card={card} />);
    expect(screen.getByText(/Alex asks to take this card over/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hand it over" }));
    expect(screen.getByRole("button", { name: "Pushing…" })).toBeDisabled();
    expect(await screen.findByText("Handed over to Alex on weft/handover/c1.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("says not now", async () => {
    m.apiFetch.mockResolvedValue(reply(200, {}));
    render(<HandoverAskBar card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByText("Told Alex not now.")).toBeInTheDocument();
  });

  it("names no branch it wasn't told, and shows a failure", async () => {
    m.apiFetch.mockResolvedValueOnce(reply(400, { error: "Couldn't push this card's work: denied" })).mockRejectedValueOnce("offline").mockResolvedValueOnce(reply(200, {}));
    render(<HandoverAskBar card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand it over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("denied");
    fireEvent.click(screen.getByRole("button", { name: "Hand it over" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Hand it over" }));
    expect(await screen.findByText("Handed over to Alex on a branch.")).toBeInTheDocument();
  });
});
