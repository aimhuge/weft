// @vitest-environment jsdom
// The "More" menu with a worker project selected: Changelog and Re-seed Backlog read and write the project's folder,
// which is on the worker, so the menu says they're this Mac's only instead of offering a button that fails.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "./test-utils";
import ProjectMenu from "./ProjectMenu";

vi.mock("./ReseedButton", () => ({ default: () => <button>Re-seed Backlog</button> }));

afterEach(cleanup);

const row = (path: string) => ({ path, lastActivity: 0, cards: 1, running: 0, needsYou: 0 });

function menu(selected: string) {
  render(<ProjectMenu projects={[row(selected)]} selected={selected} onSelect={vi.fn()} home="/Users/me" menuId="m" />);
}

describe("ProjectMenu", () => {
  it("offers Changelog and Re-seed Backlog on this Mac's project", () => {
    menu("/Users/me/dev/weft");
    expect(screen.getByText("Re-seed Backlog")).toBeTruthy();
    expect(screen.getByText(/Changelog of weft/)).toBeTruthy();
    expect(screen.queryByText(/this Mac's projects only/)).toBeNull();
  });

  it("says they're this Mac's only on a worker project", () => {
    menu("worker://w1/ling");
    expect(screen.queryByText("Re-seed Backlog")).toBeNull();
    expect(screen.queryByText(/Changelog of/)).toBeNull();
    expect(screen.getByText(/Changelog and Re-seed Backlog run on this Mac's projects only/)).toBeTruthy();
  });
});
