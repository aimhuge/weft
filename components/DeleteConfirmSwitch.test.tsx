// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import DeleteConfirmSwitch from "./DeleteConfirmSwitch";
import { shouldConfirmDelete } from "@/lib/delete-confirm";
import "./test-utils";

beforeEach(() => localStorage.clear());

describe("DeleteConfirmSwitch", () => {
  it("says Weft is asking by default", () => {
    render(<DeleteConfirmSwitch />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(shouldConfirmDelete()).toBe(true);
  });

  it("turns the question off and the flag follows", async () => {
    render(<DeleteConfirmSwitch />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(shouldConfirmDelete()).toBe(false);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("turns the question back on, which is the way out of the one-way door", async () => {
    // The flag was set by ticking "Don't ask again" in the delete dialog.
    localStorage.setItem("weft.delete.skipConfirm", "1");
    render(<DeleteConfirmSwitch />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(shouldConfirmDelete()).toBe(true);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
