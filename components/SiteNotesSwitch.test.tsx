// @vitest-environment jsdom
// Settings → Security → Site notes: the public-sharing switch and the outbox you read before anything is sent.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-api", () => ({ call }));
const { SiteNotesSwitch } = await import("./SiteNotesSwitch");

afterEach(cleanup);
beforeEach(() => call.mockReset());

const item = (id: string) => ({ id, host: "supabase.com", path: `/${id}`, body: `# Note ${id}\nPurpose: test.` });

describe("SiteNotesSwitch", () => {
  it("starts off and turns public sharing on", async () => {
    call.mockResolvedValueOnce({ public: false, outbox: [] }).mockResolvedValueOnce({ public: true, outbox: [] });
    render(<SiteNotesSwitch />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(call).toHaveBeenLastCalledWith("PUT", "/api/site-notes", { on: true });
    await waitFor(() => expect(box).toBeChecked());
  });

  it("puts the switch back when saving fails", async () => {
    call.mockResolvedValueOnce({ public: false, outbox: [] }).mockRejectedValueOnce(new Error("no"));
    render(<SiteNotesSwitch />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it("reads off when the route can't be reached", async () => {
    call.mockRejectedValueOnce(new Error("offline"));
    render(<SiteNotesSwitch />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
  });

  it("shows each waiting note in full, and sends or discards it", async () => {
    call.mockResolvedValueOnce({ public: true, outbox: [item("a"), item("b")] });
    render(<SiteNotesSwitch />);
    expect(await screen.findByText(/# Note a/)).toBeInTheDocument();
    call.mockResolvedValueOnce({ outbox: [item("b")] });
    fireEvent.click(screen.getAllByText("Send")[0] as HTMLElement);
    expect(call).toHaveBeenLastCalledWith("POST", "/api/site-notes", { action: "send", ids: ["a"] });
    await waitFor(() => expect(screen.queryByText(/# Note a/)).toBeNull());
    call.mockResolvedValueOnce({ outbox: [] });
    fireEvent.click(screen.getByText("Discard"));
    expect(call).toHaveBeenLastCalledWith("POST", "/api/site-notes", { action: "discard", ids: ["b"] });
    await waitFor(() => expect(screen.queryByText(/# Note b/)).toBeNull());
  });

  it("sends them all at once", async () => {
    call.mockResolvedValueOnce({ public: true, outbox: [item("a"), item("b")] });
    render(<SiteNotesSwitch />);
    call.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(await screen.findByText("Send all 2"));
    expect(call).toHaveBeenLastCalledWith("POST", "/api/site-notes", { action: "send", ids: undefined });
    await waitFor(() => expect(screen.getByText("Send all 2")).not.toBeDisabled());
  });
});
