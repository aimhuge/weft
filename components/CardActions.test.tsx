// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardActions from "./CardActions";
import { makeCard } from "./test-utils";

const api = vi.hoisted(() => ({ skills: vi.fn(() => Promise.resolve({ skills: [] })) }));
vi.mock("@/lib/client", () => ({ api }));

function renderActions(over: Partial<Parameters<typeof CardActions>[0]> = {}) {
  const props = { card: makeCard(), live: false, onSend: vi.fn(() => Promise.resolve()), onStar: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), ...over };
  render(<CardActions {...props} />);
  return props;
}

afterEach(cleanup);

describe("CardActions", () => {
  it("opens Share… from its button", async () => {
    const onShare = vi.fn();
    renderActions({ onShare });
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledOnce();
  });

  it("leaves the share button out without a handler", () => {
    renderActions();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("archives, and deletes only after a confirm", async () => {
    const props = renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Archive card" }));
    expect(props.onArchive).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete card" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it("can't archive a live card", () => {
    renderActions({ live: true });
    expect(screen.getByRole("button", { name: "Archive card" })).toHaveProperty("disabled", true);
  });
});

describe("CardActions beside the browser pane", () => {
  it("leaves share, star and archive to the pane's toolbar", () => {
    renderActions({ onShare: vi.fn(), marksInPane: true });
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive card" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete card" })).toBeTruthy();
  });
});

describe("CardActions and the first full turn", () => {
  it("offers delete on a card that hasn't finished a turn", () => {
    renderActions({ card: makeCard({ turns: undefined, sessionId: undefined }) });
    expect(screen.getByRole("button", { name: "Delete card" })).toBeTruthy();
  });

  it("offers delete while the first turn runs, and says it stops the turn", async () => {
    const props = renderActions({ card: makeCard({ turns: undefined, sessionId: "s1" }), live: true });
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(screen.getByText(/This stops its turn\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it("leaves only archive once a turn has finished", () => {
    renderActions({ card: makeCard({ turns: 1 }) });
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive card" })).toBeTruthy();
  });

  it("leaves only archive on an idle saved session (imported, Codex)", () => {
    renderActions({ card: makeCard({ turns: undefined, sessionId: "s1" }) });
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
  });
});
