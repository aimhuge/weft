// @vitest-environment jsdom
// A teammate's card's pane and tile mark (lib/team-host.ts): whose it is, and its page, read-only.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import TeamOwnerMark, { TeamCardPicture } from "./TeamOwnerMark";
import TeamPane from "./TeamPane";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/lib/worker-native-page", async (orig) => ({ ...(await orig<typeof import("@/lib/worker-native-page")>()), useNativePage: (...args: unknown[]) => void open(...args) }));
vi.mock("./guarded", () => ({ guarded: () => (props: { actions?: React.ReactNode }) => <div data-testid="native-pane">{props.actions}</div> }));

const SHA = "a".repeat(64);
const team = { org: "0b5c7a4e-1111-4222-8333-944445555666", owner: "z", name: "Zulker Nayeen", avatar: null, device: "d" };
const card = { ...makeCard({ id: "t1" }), team };
const browser = (desktop: boolean) => ({ desktop, state: { url: "" } as never, obscured: false, width: 400, onWidth: () => {} });

afterEach(cleanup);

describe("TeamCardPicture", () => {
  it("pins a teammate's avatar to the card's picture, and leaves your own card's alone", () => {
    const { container, rerender } = render(<TeamCardPicture card={{ ...makeCard({ emoji: "🚀" }), team: { ...team, avatar: "https://a/z.png" } }} />);
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "https://a/z.png");
    expect(container.firstElementChild).toHaveAttribute("title", "Zulker Nayeen's thread, running on their Mac. Read-only here.");
    rerender(<TeamCardPicture card={makeCard({ emoji: "🚀" })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });
});

describe("TeamOwnerMark", () => {
  it("names the teammate's Mac, with no avatar in the tile's footer", () => {
    const { container } = render(<TeamOwnerMark mark={team} />);
    expect(screen.getByText("Zulker's Mac")).toBeInTheDocument();
    expect(screen.queryByText("Z")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the teammate's initial and Mac, or their picture, with its avatar", () => {
    const { rerender, container } = render(<TeamOwnerMark mark={team} avatar />);
    expect(screen.getByText("Zulker's Mac")).toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
    rerender(<TeamOwnerMark mark={{ ...team, name: " ", avatar: "https://a/z.png" }} avatar />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://a/z.png");
    rerender(<TeamOwnerMark mark={{ ...team, name: "" }} avatar />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

describe("TeamPane", () => {
  it("loads a page the card wrote in the native pane, from the team's workspace", () => {
    render(<TeamPane card={card} url={`blob:sha256:${SHA}`} browser={browser(true)} onClose={() => {}} />);
    expect(screen.getByTestId("native-pane")).toHaveTextContent("Zulker's Mac");
    expect(open).toHaveBeenLastCalledWith("t1", expect.stringContaining(`/api/worker-board/page/${SHA}?org=${team.org}`), "");
  });

  it("frames it sandboxed off the desktop app", () => {
    const { container } = render(<TeamPane card={card} url={`blob:sha256:${SHA}`} browser={browser(false)} onClose={() => {}} />);
    expect(container.querySelector("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  });

  it("links a site, and says when the page is only on their Mac or there's none", () => {
    const { rerender } = render(<TeamPane card={card} url="https://example.com/" browser={browser(false)} onClose={() => {}} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/");
    rerender(<TeamPane card={card} url="http://localhost:3000/" browser={browser(false)} onClose={() => {}} />);
    expect(screen.getByText("This page only exists on Zulker's Mac.")).toBeInTheDocument();
    rerender(<TeamPane card={card} url="" browser={browser(false)} onClose={() => {}} />);
    expect(screen.getByText("Nothing in this card's pane yet.")).toBeInTheDocument();
  });

  it("closes the pane", () => {
    const onClose = vi.fn();
    render(<TeamPane card={card} url="" browser={browser(false)} onClose={onClose} />);
    screen.getByLabelText("Close the pane").click();
    expect(onClose).toHaveBeenCalled();
  });
});
