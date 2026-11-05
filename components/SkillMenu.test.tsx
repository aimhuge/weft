// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPaneBox } from "@/lib/float-place";
import { ThreadTransportContext, type ThreadTransport } from "@/lib/thread-transport";
import "./test-utils";
import SkillMenu from "./SkillMenu";

const api = vi.hoisted(() => ({
  skills: vi.fn(() =>
    Promise.resolve({ skills: [{ name: "done", description: "Wrap up a session", source: "weft" as const }] }),
  ),
}));
vi.mock("@/lib/client", () => ({ api }));

// The Skills button where the thread panel puts it: near the left of a narrow panel, at x=180..250.
function placeButton() {
  const button = screen.getByRole("button", { name: /Skills/ });
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: 180,
    right: 250,
    top: 40,
    bottom: 70,
    width: 70,
    height: 30,
    x: 180,
    y: 40,
    toJSON: () => ({}),
  });
  return button;
}

afterEach(() => setPaneBox(null));

describe("SkillMenu", () => {
  it("lists the skills the card's transport finds (a worker's, for a worker card), not this Mac's folder", async () => {
    const listSkills = vi.fn(() => Promise.resolve([{ name: "ship", description: "Ship it", source: "project" as const }]));
    render(
      <ThreadTransportContext.Provider value={{ desktop: false, cardEdits: true, listSkills } as unknown as ThreadTransport}>
        <SkillMenu cardId="w-card" cwd="worker://w1/ling" disabled={false} onRun={() => Promise.resolve()} />
      </ThreadTransportContext.Provider>,
    );
    await userEvent.click(placeButton());
    expect(await screen.findByText("/ship")).toBeTruthy();
    expect(listSkills).toHaveBeenCalledWith("w-card", "worker://w1/ling");
    expect(api.skills).not.toHaveBeenCalled();
  });

  it("offers nothing where the transport has no list", async () => {
    render(
      <ThreadTransportContext.Provider value={{ desktop: false } as unknown as ThreadTransport}>
        <SkillMenu cwd="/p" disabled={false} onRun={() => Promise.resolve()} />
      </ThreadTransportContext.Provider>,
    );
    await userEvent.click(placeButton());
    expect(await screen.findByLabelText("Find a skill")).toBeTruthy();
    expect(screen.queryByText("/done")).toBeNull();
  });

  it("draws its menu in the body, inside the window, so a narrow panel can't clip it", async () => {
    const { container } = render(<SkillMenu cwd="/p" disabled={false} onRun={() => Promise.resolve()} />);
    await userEvent.click(placeButton());
    const input = await screen.findByLabelText("Find a skill");
    const menu = input.closest<HTMLElement>("[id]")!;
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.left).toBe("8px");
    expect(menu.style.top).toBe("76px");
    expect(await screen.findByText("/done")).toBeTruthy();
  });

  it("closes on a click outside, and stays open on a click inside the portal", async () => {
    render(<SkillMenu cwd="/p" disabled={false} onRun={() => Promise.resolve()} />);
    await userEvent.click(placeButton());
    const input = await screen.findByLabelText("Find a skill");
    await userEvent.click(input);
    expect(screen.queryByLabelText("Find a skill")).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByLabelText("Find a skill")).toBeNull();
  });
});
