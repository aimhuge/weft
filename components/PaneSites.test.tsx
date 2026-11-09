// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import PaneSites from "./PaneSites";

type Bridge = { sites: () => Promise<string[]>; addSite: (h: string) => Promise<string | null>; removeSite: (h: string) => Promise<boolean> };
const withBridge = (browser: Partial<Bridge> | undefined) => Object.defineProperty(window, "weft", { value: browser ? { browser } : undefined, configurable: true });

afterEach(() => withBridge(undefined));

describe("PaneSites", () => {
  it("says it's desktop-only without the shell's list", () => {
    withBridge(undefined);
    render(<PaneSites />);
    expect(screen.getByText("Only in the desktop app.")).toBeInTheDocument();
  });

  it("lists the saved sites and takes one back out", async () => {
    const removeSite = vi.fn().mockResolvedValue(true);
    withBridge({ sites: () => Promise.resolve(["tiktok.com", "x.com"]), removeSite });
    render(<PaneSites />);
    fireEvent.click(await screen.findByLabelText("Ask again before opening tiktok.com"));
    await waitFor(() => expect(screen.queryByText("tiktok.com")).not.toBeInTheDocument());
    expect(removeSite).toHaveBeenCalledWith("tiktok.com");
    expect(screen.getByText("x.com")).toBeInTheDocument();
  });

  it("adds a site as the shell names it", async () => {
    const addSite = vi.fn().mockResolvedValue("tiktok.com");
    withBridge({ sites: () => Promise.resolve([]), addSite });
    render(<PaneSites />);
    fireEvent.change(await screen.findByLabelText("Site to allow"), { target: { value: "https://tiktok.com/foryou" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("tiktok.com")).toBeInTheDocument();
    expect(addSite).toHaveBeenCalledWith("https://tiktok.com/foryou");
    expect(screen.getByLabelText("Site to allow")).toHaveValue("");
  });

  it("says so when the shell can't read the address", async () => {
    withBridge({ sites: () => Promise.resolve([]), addSite: vi.fn().mockResolvedValue(null) });
    render(<PaneSites />);
    fireEvent.change(await screen.findByLabelText("Site to allow"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(await screen.findByText('"nope" isn\'t a site\'s address.')).toBeInTheDocument();
  });
});
