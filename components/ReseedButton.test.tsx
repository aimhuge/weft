// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const seedProject = vi.fn();
vi.mock("@/lib/client", () => ({ api: { seedProject: (p: string): unknown => seedProject(p) } }));

import ReseedButton from "./ReseedButton";

beforeEach(() => seedProject.mockReset());

describe("ReseedButton", () => {
  it("re-seeds the project and says how many cards it added", async () => {
    seedProject.mockResolvedValue({ added: 2 });
    render(<ReseedButton path="/p" className="x" />);
    fireEvent.click(screen.getByRole("button", { name: /Re-seed Backlog/ }));
    await waitFor(() => expect(screen.getByText("Added 2 cards")).toBeInTheDocument());
    expect(seedProject).toHaveBeenCalledWith("/p");
  });

  it("says when there was nothing new, and shows an error", async () => {
    seedProject.mockResolvedValueOnce({ added: 0 });
    render(<ReseedButton path="/p" className="x" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Nothing new")).toBeInTheDocument());
    seedProject.mockRejectedValueOnce(new Error("no gh"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("no gh")).toBeInTheDocument());
    seedProject.mockRejectedValueOnce("odd");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("odd")).toBeInTheDocument());
  });
});
