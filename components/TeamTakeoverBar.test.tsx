// @vitest-environment jsdom
// Continue here on a teammate's card (lib/team-takeover.ts), and the marks a takeover leaves (TeamOwnerMark).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import TeamOwnerMark, { HandoverAskMark, takenLabel, TakenOverMark } from "./TeamOwnerMark";
import TeamTakeoverBar, { askFor, takeOver, teamBarText } from "./TeamTakeoverBar";
import type { HandoverState, HandoverStatus } from "@/lib/types";

const m = vi.hoisted(() => ({ apiFetch: vi.fn(), openCardById: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: m.apiFetch }));
vi.mock("@/lib/open-card", () => ({ openCardById: m.openCardById }));

const team = { org: "0b5c7a4e-1111-4222-8333-944445555666", owner: "z", name: "Zulker Nayeen", avatar: null, device: "d" };
const card = { ...makeCard({ id: "t1" }), team };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  m.apiFetch.mockReset();
  m.openCardById.mockReset();
});
afterEach(cleanup);

describe("takeOver and askFor", () => {
  it("post the workspace and card, asking with ask: true", async () => {
    m.apiFetch.mockResolvedValue(reply(200, { card: { id: "new" }, id: "h1" }));
    expect(await takeOver(team, "t1")).toEqual({ id: "new" });
    expect(await askFor(team, "t1")).toEqual({ card: { id: "new" }, id: "h1" });
    const bodies = m.apiFetch.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string) as unknown);
    expect(bodies).toEqual([{ org: team.org, card: "t1" }, { org: team.org, card: "t1", ask: true }]);
    expect(m.apiFetch.mock.calls[0]?.[0]).toBe("/api/team-board");
  });

  it("throw the server's reason, or a plain one", async () => {
    m.apiFetch.mockResolvedValueOnce(reply(400, { error: "Check out acme/app first" }));
    await expect(takeOver(team, "t1")).rejects.toThrow("Check out acme/app first");
    m.apiFetch.mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.reject(new Error("not json")) });
    await expect(takeOver(team, "t1")).rejects.toThrow("Couldn't take that card over.");
    m.apiFetch.mockResolvedValueOnce(reply(502, {}));
    await expect(askFor(team, "t1")).rejects.toThrow("Couldn't ask for that card.");
    m.apiFetch.mockResolvedValueOnce(reply(200, {}));
    await expect(takeOver(team, "t1")).rejects.toThrow("Couldn't take that card over.");
  });
});

describe("teamBarText", () => {
  const at = (status: HandoverStatus, extra: Partial<HandoverState> = {}) => teamBarText({ ...team, handover: { id: "h", status, ...extra } });

  it("says whose Mac runs it, or who took it over", () => {
    expect(teamBarText(team)).toBe("This runs on Zulker's Mac. Ask them to hand it over with their latest work, or take it over now from what they've pushed.");
    expect(teamBarText({ ...team, takenOver: { name: "Alex Miller", at: "t" } })).toBe("Alex Miller took this over from Zulker Nayeen.");
    expect(teamBarText({ ...team, name: " " })).toContain("your teammate's Mac");
  });

  it("says where your ask stands", () => {
    expect(at("asked")).toBe("Asked Zulker. Your card starts from their work as soon as they hand it over.");
    expect(at("pushing")).toBe("Zulker said yes: their Mac is pushing the card's work…");
    expect(at("pushed", { branch: "weft/handover/t1" })).toBe("Zulker handed it over on weft/handover/t1. Starting your card…");
    expect(at("taken")).toBe("Zulker handed it over on a branch. Starting your card…");
    expect(at("declined")).toBe("Zulker said not now. You can still take it over from what they've pushed.");
    expect(at("failed", { note: "push refused" })).toBe("push refused");
    expect(at("cancelled")).toBe("The handover didn't go through. You can still take it over from what Zulker has pushed.");
  });
});

describe("TeamTakeoverBar", () => {
  it("takes the card over now and opens yours", async () => {
    m.apiFetch.mockResolvedValue(reply(200, { card: { id: "new" } }));
    render(<TeamTakeoverBar card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over now" }));
    expect(screen.getByRole("button", { name: "Taking over…" })).toBeDisabled();
    await waitFor(() => expect(m.openCardById).toHaveBeenCalledWith("new"));
  });

  it("asks them, opening nothing", async () => {
    m.apiFetch.mockResolvedValue(reply(200, { id: "h1" }));
    render(<TeamTakeoverBar card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Zulker" }));
    expect(screen.getByRole("button", { name: "Asking…" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask Zulker" })).toBeEnabled());
    expect(m.openCardById).not.toHaveBeenCalled();
  });

  it("offers only Take over now while an ask waits, and neither once it's handed over", () => {
    const { rerender } = render(<TeamTakeoverBar card={{ ...card, team: { ...team, handover: { id: "h", status: "asked" } } }} />);
    expect(screen.queryByRole("button", { name: "Ask Zulker" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take over now" })).toBeInTheDocument();
    rerender(<TeamTakeoverBar card={{ ...card, team: { ...team, handover: { id: "h", status: "pushed" } } }} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<TeamTakeoverBar card={{ ...card, team: { ...team, handover: { id: "h", status: "declined" } } }} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("shows why it couldn't and lets you try again", async () => {
    m.apiFetch.mockResolvedValueOnce(reply(400, { error: "Sign in to Weft to take over a teammate's card." }));
    m.apiFetch.mockRejectedValueOnce("offline");
    render(<TeamTakeoverBar card={card} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to Weft");
    fireEvent.click(screen.getByRole("button", { name: "Ask Zulker" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(m.openCardById).not.toHaveBeenCalled();
  });
});

describe("takeover marks", () => {
  it("say who has a taken card now, on theirs and on yours", () => {
    expect(takenLabel({ name: "Alex Miller", at: "t" })).toBe("Alex has it");
    expect(takenLabel({ name: " ", at: "t" })).toBe("A teammate has it");
    render(<TeamOwnerMark mark={{ ...team, takenOver: { name: "Alex Miller", at: "t" } }} />);
    expect(screen.getByText("Alex has it").parentElement).toHaveAttribute("title", "Zulker Nayeen's thread. Alex Miller took it over and carries it on on their Mac.");
    cleanup();
    render(<TakenOverMark taken={{ name: "Alex Miller", at: "t" }} />);
    expect(screen.getByText("Alex has it")).toHaveAttribute("title", "Alex Miller took this card over and carries it on on their Mac.");
    cleanup();
    render(<HandoverAskMark name="Alex Miller" />);
    expect(screen.getByText("Alex asks for it")).toHaveAttribute("title", "Alex Miller asks to take this card over. Open it to answer.");
    cleanup();
    render(<HandoverAskMark name=" " />);
    expect(screen.getByText("A teammate asks for it")).toBeInTheDocument();
  });
});
