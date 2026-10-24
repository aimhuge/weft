// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldConfirmDelete } from "@/lib/delete-confirm";
import "./test-utils";
import DeleteCardDialog from "./DeleteCardDialog";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function setup(over: Partial<Parameters<typeof DeleteCardDialog>[0]> = {}) {
  const props = { title: "Make all model selection match", live: false, onCancel: vi.fn(), onConfirm: vi.fn(), ...over };
  render(<DeleteCardDialog {...props} />);
  return props;
}

describe("DeleteCardDialog", () => {
  it("names the card and says its transcript stays on disk", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Delete card" })).toBeInTheDocument();
    expect(screen.getByText(/Make all model selection match/)).toBeInTheDocument();
    expect(screen.getByText(/CLI transcript stays on disk/)).toBeInTheDocument();
  });

  it("says it stops the turn when the card is running", () => {
    setup({ live: true });
    expect(screen.getByText(/This stops its turn\./)).toBeInTheDocument();
  });

  it("leaves that line out on an idle card", () => {
    setup();
    expect(screen.queryByText(/This stops its turn\./)).toBeNull();
  });

  it("cancels without deleting", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("deletes on Delete", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("remembers 'Don't ask again'", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(shouldConfirmDelete()).toBe(false);
  });

  it("leaves the preference alone when the box isn't ticked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(shouldConfirmDelete()).toBe(true);
  });

  it("closes on Escape without deleting", async () => {
    const props = setup();
    await userEvent.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
