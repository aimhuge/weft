// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlackChannel } from "@/lib/slack-types";
import "./test-utils";
import { SlackChannelButton, SlackChannelSelect } from "./SlackChannelPicker";

// The Slack drawer's channel field (components/SlackChannelPicker.tsx): a button naming the channel, and the drawers'
// search picker (DbSelect) to change it, best fits for the project first.

const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "general", isPrivate: false, isMember: true },
  { id: "C2", name: "weft-dev", isPrivate: false, isMember: false },
  { id: "C3", name: "secret", isPrivate: true, isMember: false },
];

function select(over: Partial<Parameters<typeof SlackChannelSelect>[0]> = {}) {
  const props = {
    channels: CHANNELS,
    title: "Channel for weft",
    folder: "/dev/weft",
    selected: "",
    busy: false,
    onPick: vi.fn(),
    onCancel: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve({ id: "C9", name: "made", isPrivate: false, isMember: true })),
    ...over,
  };
  render(<SlackChannelSelect {...props} />);
  return props;
}

describe("SlackChannelButton", () => {
  it("names the channel, or says there is none, and toggles", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<SlackChannelButton channel={CHANNELS[0]!} label="Channel" placeholder="No default channel" open={false} busy={false} onToggle={onToggle} />);
    expect(screen.getByLabelText("Channel")).toHaveTextContent("#general");
    fireEvent.click(screen.getByLabelText("Channel"));
    expect(onToggle).toHaveBeenCalled();
    rerender(<SlackChannelButton channel={null} label="Channel" placeholder="No default channel" open busy={false} onToggle={onToggle} />);
    expect(screen.getByLabelText("Channel")).toHaveTextContent("No default channel");
    expect(screen.getByLabelText("Channel")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("SlackChannelSelect", () => {
  it("puts the channel named like the project first, marked best fit, with each channel's hint", () => {
    select();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("#weft-dev");
    expect(rows[0]).toHaveTextContent("best fit");
    expect(screen.getByRole("button", { name: /#secret/ })).toHaveTextContent("invite @Weft");
    expect(screen.getByRole("button", { name: /#weft-dev/ })).toHaveTextContent("joins on first post");
  });

  it("narrows as you type and picks a row", () => {
    const p = select();
    fireEvent.change(screen.getByLabelText("Search channels"), { target: { value: "gen" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /#general/ }));
    expect(p.onPick).toHaveBeenCalledWith(CHANNELS[0]);
  });

  it("says when nothing matches, or when Slack listed nothing", () => {
    select({ channels: [] });
    expect(screen.getByText(/Slack listed no channels/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search channels"), { target: { value: "x" } });
    expect(screen.getByText("No channel matches.")).toBeInTheDocument();
  });

  it("clears a saved channel, and backs out with Cancel", () => {
    const p = select({ selected: "C1" });
    fireEvent.click(screen.getByRole("button", { name: "No channel" }));
    expect(p.onPick).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancel).toHaveBeenCalled();
  });

  it("offers no clearing when nothing is saved", () => {
    select();
    expect(screen.queryByRole("button", { name: "No channel" })).toBeNull();
  });
});

describe("a new channel", () => {
  const MADE: SlackChannel = { id: "C9", name: "weft-updates", isPrivate: false, isMember: true };

  // The "+ New channel" button: the hint is what the channel would be called.
  const newButton = () => screen.getByRole("button", { name: /New channel/ });

  it("suggests the name that was searched for", () => {
    select();
    expect(newButton()).toHaveTextContent("#weft");
    fireEvent.change(screen.getByLabelText("Search channels"), { target: { value: "Dev Updates" } });
    expect(newButton()).toHaveTextContent("#dev-updates");
  });

  it("falls back to the project's own name", () => {
    select({ folder: "/dev/weft" });
    expect(newButton()).toHaveTextContent("#weft");
  });

  it("has no hint at all with no project to name it after", () => {
    select({ folder: null });
    expect(newButton()).not.toHaveTextContent("#");
  });

  it("opens a form prefilled with the suggestion, and hides the search box", () => {
    select();
    fireEvent.click(newButton());
    expect(screen.getByLabelText("New channel's name")).toHaveValue("weft");
    expect(screen.queryByLabelText("Search channels")).toBeNull();
  });

  it("makes the channel and picks it", async () => {
    const p = select({ onCreate: vi.fn(() => Promise.resolve(MADE)) });
    fireEvent.click(newButton());
    fireEvent.change(screen.getByLabelText("New channel's name"), { target: { value: "Weft Updates" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith("weft-updates"));
    await waitFor(() => expect(p.onPick).toHaveBeenCalledWith(MADE));
  });

  it("shows what went wrong and keeps the form open", async () => {
    const p = select({ onCreate: vi.fn(() => Promise.reject(new Error("#weft is taken"))) });
    fireEvent.click(newButton());
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByText("#weft is taken")).toBeInTheDocument());
    expect(screen.getByLabelText("New channel's name")).toBeInTheDocument();
    expect(p.onPick).not.toHaveBeenCalled();
    // The form is usable again after the failure.
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });

  it("says what Slack will name it, when the name has to change", () => {
    select();
    fireEvent.click(newButton());
    expect(screen.queryByText(/Slack will name it/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New channel's name"), { target: { value: "Weft Updates" } });
    expect(screen.getByText("Slack will name it #weft-updates")).toBeInTheDocument();
    // A name Slack already accepts is said once, not twice.
    fireEvent.change(screen.getByLabelText("New channel's name"), { target: { value: "weft-updates" } });
    expect(screen.queryByText(/Slack will name it/)).not.toBeInTheDocument();
  });

  it("goes back to the list, with the button and with Escape", () => {
    select();
    fireEvent.click(newButton());
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(screen.getByLabelText("Search channels")).toBeInTheDocument();
    expect(screen.queryByLabelText("New channel's name")).toBeNull();

    fireEvent.click(newButton());
    fireEvent.keyDown(screen.getByLabelText("New channel's name"), { key: "Escape" });
    expect(screen.getByLabelText("Search channels")).toBeInTheDocument();
    expect(screen.queryByLabelText("New channel's name")).toBeNull();
  });

  it("has no Create to press until the name is one Slack accepts", () => {
    select();
    fireEvent.click(newButton());
    fireEvent.change(screen.getByLabelText("New channel's name"), { target: { value: "!!!" } });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("New channel's name"), { target: { value: "weft-updates" } });
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });
});
