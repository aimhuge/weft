// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlackChannel, SlackLink } from "@/lib/slack-types";
import "./test-utils";
import SlackLinks from "./SlackLinks";

// The drawer's map of projects to their own channels (components/SlackLinks.tsx): a row saves once it has both
// halves, a half-changed row goes away, and a project that doesn't sync can be told to.

const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "eng", isPrivate: false, isMember: true },
  { id: "C2", name: "site", isPrivate: false, isMember: true },
];

const FOLDERS = ["/dev/app", "/dev/site"];

const LINK: SlackLink = { folder: "/dev/app", channel: "C1", channelName: "eng" };

function props(over: Partial<Parameters<typeof SlackLinks>[0]> = {}) {
  return {
    links: [LINK] as SlackLink[],
    channels: CHANNELS,
    folders: FOLDERS,
    synced: [] as string[],
    busy: false,
    onSave: vi.fn(),
    onSync: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve({ id: "C9", name: "made", isPrivate: false, isMember: true })),
    ...over,
  };
}

// The picker's "+ New channel" button carries a "#name" hint, so a channel row is found by its own
// list item rather than by a name that the hint could also match.
function channelRow(name: string) {
  const row = screen.getAllByRole("listitem").find((li) => li.textContent.includes(name));
  if (!row) throw new Error(`no channel row named ${name}`);
  return within(row).getByRole("button");
}

const change = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const click = (el: Element) => fireEvent.click(el);

// A row's fields, in order: the project select and then its channel button.
const selects = (name: string) => screen.getAllByLabelText(name);

describe("SlackLinks", () => {
  it("shows a row for each link", () => {
    render(<SlackLinks {...props({ links: [LINK, { folder: "/dev/site", channel: "C2", channelName: "site" }] })} />);
    expect(screen.getAllByLabelText("Project")).toHaveLength(2);
    expect(screen.getAllByLabelText("Its channel")).toHaveLength(2);
  });

  it("saves a row with its new channel", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    click(selects("Its channel")[0]!);
    click(channelRow("#site"));
    expect(p.onSave).toHaveBeenCalledWith({ links: [{ folder: "/dev/app", channel: "C2", channelName: "site" }] });
  });

  it("saves a row with its new project", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    change(selects("Project")[0]!, "/dev/site");
    expect(p.onSave).toHaveBeenCalledWith({ links: [{ folder: "/dev/site", channel: "C1", channelName: "eng" }] });
  });

  it("takes a row away when half of it is cleared", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    change(selects("Project")[0]!, "");
    expect(p.onSave).toHaveBeenCalledWith({ links: [] });
  });

  it("adds a draft row that saves once it has both halves", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    click(screen.getByRole("button", { name: "+ Map a project to a channel" }));
    expect(screen.getAllByLabelText("Project")).toHaveLength(2);
    expect(p.onSave).not.toHaveBeenCalled();

    // A project alone isn't enough: the draft waits.
    change(selects("Project")[1]!, "/dev/site");
    expect(p.onSave).not.toHaveBeenCalled();

    click(selects("Its channel")[1]!);
    click(channelRow("#site"));
    expect(p.onSave).toHaveBeenCalledWith({ links: [LINK, { folder: "/dev/site", channel: "C2", channelName: "site" }] });
  });

  it("takes a saved row away and throws a draft away", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    click(screen.getByRole("button", { name: "Remove" }));
    expect(p.onSave).toHaveBeenCalledWith({ links: [] });

    click(screen.getByRole("button", { name: "+ Map a project to a channel" }));
    expect(screen.getAllByLabelText("Project")).toHaveLength(2);
    click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(screen.getAllByLabelText("Project")).toHaveLength(1);
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it("offers to turn the sync on for a project that doesn't have it", () => {
    const p = props();
    render(<SlackLinks {...p} />);
    expect(screen.getByText(/weft.zip links need sync/)).toBeInTheDocument();
    click(screen.getByRole("button", { name: "Turn on sync" }));
    expect(p.onSync).toHaveBeenCalledWith("/dev/app");
  });

  it("says nothing about the sync for a project that has it", () => {
    render(<SlackLinks {...props({ synced: ["/dev/app"] })} />);
    expect(screen.queryByText(/weft.zip links need sync/)).not.toBeInTheDocument();
  });

  it("offers no new row when there are no channels to map", () => {
    render(<SlackLinks {...props({ channels: [] })} />);
    expect(screen.getByRole("button", { name: "+ Map a project to a channel" })).toBeDisabled();
  });
});
