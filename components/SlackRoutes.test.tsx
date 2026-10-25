// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlackChannel, SlackSettings } from "@/lib/slack-types";
import "./test-utils";
import SlackRoutes from "./SlackRoutes";

// Where each kind of update goes (components/SlackRoutes.tsx): one row per kind, so commits can go to one
// channel and deploys to another.

const SETTINGS: SlackSettings = {
  channel: "C1",
  channelName: "general",
  folder: null,
  links: [],
  events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
  routes: {},
};

const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "general", isPrivate: false, isMember: true },
  { id: "C9", name: "user-growth", isPrivate: false, isMember: true },
];

function props(over: Partial<React.ComponentProps<typeof SlackRoutes>> = {}) {
  return {
    settings: SETTINGS,
    channels: CHANNELS,
    busy: false,
    onSave: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve({ id: "C9", name: "made", isPrivate: false, isMember: true })),
    ...over,
  };
}

const click = (el: Element) => fireEvent.click(el);
const row = (kind: string) => screen.getByLabelText(new RegExp(`^Channel for ${kind}`));

describe("SlackRoutes", () => {
  it("offers a row for every kind of update", () => {
    render(<SlackRoutes {...props()} />);
    expect(row("Commits")).toBeInTheDocument();
    expect(row("Deploys")).toBeInTheDocument();
    expect(row("Growth")).toBeInTheDocument();
  });

  it("shows the default channel for a kind that has none of its own", () => {
    render(<SlackRoutes {...props()} />);
    expect(row("Commits")).toHaveTextContent("Default");
  });

  it("saves the channel a kind is given", () => {
    const p = props();
    render(<SlackRoutes {...p} />);
    click(row("Growth"));
    click(screen.getByRole("button", { name: /user-growth/ }));
    expect(p.onSave).toHaveBeenCalledWith({ routes: { growth: { channel: "C9", channelName: "user-growth" } } });
  });

  it("clears a kind's channel when there is none to pick", () => {
    const p = props({ settings: { ...SETTINGS, routes: { growth: { channel: "C9", channelName: "user-growth" } } } });
    render(<SlackRoutes {...p} />);
    expect(row("Growth")).toHaveTextContent("user-growth");
    click(row("Growth"));
    click(screen.getByRole("button", { name: "No channel" }));
    // Null clears the row: that kind goes back to the default channel.
    expect(p.onSave).toHaveBeenCalledWith({ routes: { growth: null } });
  });

  it("names a saved channel the list doesn't have yet", () => {
    const p = props({ settings: { ...SETTINGS, routes: { growth: { channel: "C8", channelName: "gone" } } } });
    render(<SlackRoutes {...p} />);
    expect(row("Growth")).toHaveTextContent("gone");
  });
});
