// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { manifestUrl } from "@/lib/slack-view";
import type { SlackChannel, SlackSettings, SlackStatus } from "@/lib/slack-types";
import "./test-utils";
import SlackDrawer, { type SlackDrawerProps } from "./SlackDrawer";

const STATUS: SlackStatus = { signedIn: true, team: "Acme", teamUrl: null, bot: "Weft", socket: "connected", error: null };
const SETTINGS: SlackSettings = { channel: null, channelName: null, folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } };
const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "eng", isPrivate: false, isMember: true },
  { id: "C2", name: "secret", isPrivate: true, isMember: false },
];

function props(over: Partial<SlackDrawerProps> = {}): SlackDrawerProps {
  return {
    status: STATUS,
    settings: SETTINGS,
    folderSynced: false,
    synced: [],
    channels: CHANNELS,
    channelsError: null,
    loading: false,
    error: null,
    note: null,
    refresh: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve(STATUS)),
    disconnect: vi.fn(() => Promise.resolve(null)),
    loadChannels: vi.fn(() => Promise.resolve(CHANNELS)),
    createChannel: vi.fn(() => Promise.resolve({ id: "C9", name: "made", isPrivate: false, isMember: true })),
    save: vi.fn(() => Promise.resolve({})),
    test: vi.fn(() => Promise.resolve({ ok: true })),
    syncFolder: vi.fn(() => Promise.resolve(true)),
    folders: ["/dev/app", "/dev/site"],
    project: null,
    onOpenUrl: vi.fn(),
    notify: vi.fn(),
    ...over,
  };
}

// The drawer answers to clicks and changes, so fireEvent drives it: userEvent's per-keystroke delays make
// this file the slowest in the suite on a loaded box.
const click = (el: Element) => fireEvent.click(el);
const change = (el: Element, value: string) => fireEvent.change(el, { target: { value } });

describe("SlackDrawer", () => {
  it("explains itself outside the desktop app, while loading and on an error", () => {
    const { rerender } = render(<SlackDrawer {...props({ note: "Slack connects in Weft's desktop app.", status: null })} />);
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    rerender(<SlackDrawer {...props({ status: null, note: null })} />);
    expect(screen.getByText("Asking Slack…")).toBeInTheDocument();
    rerender(<SlackDrawer {...props({ status: null, note: null, error: "offline" })} />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("asks for the tokens, opens the manifest page and connects", async () => {
    const p = props({ status: { ...STATUS, signedIn: false }, connect: vi.fn(() => Promise.resolve(STATUS)) });
    render(<SlackDrawer {...p} />);
    expect(screen.getByText("Connect Slack")).toBeInTheDocument();
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    click(screen.getByRole("button", { name: "Create the Weft app" }));
    expect(p.onOpenUrl).toHaveBeenCalledWith(manifestUrl());
    change(screen.getByLabelText("Bot User OAuth Token"), "xoxb-1");
    change(screen.getByLabelText("App-Level Token"), "xapp-1");
    expect(connect).not.toBeDisabled();
    fireEvent.submit(connect.closest("form") as HTMLFormElement);
    await waitFor(() => expect(p.connect).toHaveBeenCalledWith("xoxb-1", "xapp-1"));
    await waitFor(() => expect(screen.getByLabelText("Bot User OAuth Token")).toHaveValue(""));
    expect(screen.getByLabelText("App-Level Token")).toHaveValue("");
  });

  it("shows the error a failed connect leaves", () => {
    render(<SlackDrawer {...props({ status: { ...STATUS, signedIn: false, error: "token turned down" } })} />);
    expect(screen.getByText("token turned down")).toBeInTheDocument();
  });

  it("shows the workspace, the bot and the socket", () => {
    render(<SlackDrawer {...props()} />);
    expect(screen.getByText(/Acme · Weft · listening for \/weft/)).toBeInTheDocument();
  });

  it("disconnects", async () => {
    const p = props();
    render(<SlackDrawer {...p} />);
    click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(p.disconnect).toHaveBeenCalled());
  });

  it("saves the channel it picks", async () => {
    const p = props();
    render(<SlackDrawer {...p} />);
    click(screen.getByLabelText("Channel"));
    click(screen.getByRole("button", { name: /#secret/ }));
    await waitFor(() => expect(p.save).toHaveBeenCalledWith({ channel: "C2", channelName: "secret" }));
  });

  it("marks a private channel the bot isn't in", () => {
    render(<SlackDrawer {...props()} />);
    click(screen.getByLabelText("Channel"));
    expect(screen.getByRole("button", { name: /#secret/ })).toHaveTextContent("invite @Weft");
  });

  it("saves an events patch when a box is ticked", async () => {
    const p = props({ settings: { ...SETTINGS, events: { ...SETTINGS.events, commits: false } } });
    render(<SlackDrawer {...p} />);
    const commits = screen.getByRole("checkbox", { name: "Commits" });
    expect(commits).not.toBeChecked();
    click(commits);
    await waitFor(() => expect(p.save).toHaveBeenCalledWith({ events: { commits: true } }));
  });

  it("saves the folder a Slack card runs in", async () => {
    const p = props();
    render(<SlackDrawer {...p} />);
    change(screen.getByLabelText("Cards from Slack start in"), "/dev/site");
    await waitFor(() => expect(p.save).toHaveBeenCalledWith({ folder: "/dev/site" }));
  });

  it("names the default channel, the project channels and where other channels' cards start", () => {
    render(<SlackDrawer {...props()} />);
    expect(screen.getByText("Default channel")).toBeInTheDocument();
    expect(screen.getByText("Project channels")).toBeInTheDocument();
    expect(screen.getByText("Cards from other channels start in")).toBeInTheDocument();
  });

  it("offers no default channel and no default project", () => {
    render(<SlackDrawer {...props()} />);
    expect(screen.getByLabelText("Channel")).toHaveTextContent("No default channel");
    expect(screen.getByRole("option", { name: "No default project" })).toBeInTheDocument();
  });

  it("offers to turn the folder's sync on until it is on", async () => {
    const p = props({ settings: { ...SETTINGS, folder: "/dev/app" } });
    const { rerender } = render(<SlackDrawer {...p} />);
    expect(screen.getByText("Links open the card on weft.zip once this project syncs")).toBeInTheDocument();
    click(screen.getByRole("button", { name: "Turn on sync" }));
    await waitFor(() => expect(p.syncFolder).toHaveBeenCalledWith("/dev/app"));
    rerender(<SlackDrawer {...props({ settings: { ...SETTINGS, folder: "/dev/app" }, folderSynced: true })} />);
    expect(screen.queryByText("Links open the card on weft.zip once this project syncs")).not.toBeInTheDocument();
  });

  it("sends a test message and toasts a failure", async () => {
    const p = props();
    render(<SlackDrawer {...p} />);
    click(screen.getByRole("button", { name: "Send a test message" }));
    await waitFor(() => expect(p.test).toHaveBeenCalled());
    const failing = props({ test: vi.fn(() => Promise.reject(new Error("no channel"))) });
    render(<SlackDrawer {...failing} />);
    click(screen.getAllByRole("button", { name: "Send a test message" })[1]!);
    await waitFor(() => expect(failing.notify).toHaveBeenCalledWith(new Error("no channel")));
  });

  it("loads the channels when it opens", async () => {
    const p = props();
    render(<SlackDrawer {...p} />);
    await waitFor(() => expect(p.loadChannels).toHaveBeenCalled());
  });

  it("says how to use it", () => {
    render(<SlackDrawer {...props()} />);
    expect(screen.getByText(/\/weft <what to build>/)).toBeInTheDocument();
    expect(screen.getByText(/@Weft in a card's thread talks to that card/)).toBeInTheDocument();
  });

  it("loads the channels once Slack connects, not before", () => {
    const loadChannels = vi.fn(() => Promise.resolve(CHANNELS));
    const { rerender } = render(<SlackDrawer {...props({ status: { ...STATUS, signedIn: false }, loadChannels })} />);
    expect(loadChannels).not.toHaveBeenCalled();
    rerender(<SlackDrawer {...props({ loadChannels })} />);
    expect(loadChannels).toHaveBeenCalledOnce();
  });

  it("says why there are no channels and asks again", async () => {
    const loadChannels = vi.fn(() => Promise.resolve([]));
    render(<SlackDrawer {...props({ channels: [], channelsError: "This Slack token is missing the channels:read scope.", loadChannels })} />);
    expect(screen.getByText(/missing the channels:read scope/)).toBeInTheDocument();
    click(screen.getByRole("button", { name: "Reload channels" }));
    await waitFor(() => expect(loadChannels).toHaveBeenCalledTimes(2));
  });

  it("says it's still asking while the list is empty", () => {
    render(<SlackDrawer {...props({ channels: [] })} />);
    expect(screen.getByText("Asking Slack for channels…")).toBeInTheDocument();
  });
});
