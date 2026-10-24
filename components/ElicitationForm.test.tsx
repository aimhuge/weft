// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PendingElicitation } from "@/lib/types";
import ElicitationForm, { initialAnswers } from "./ElicitationForm";
import "./test-utils";

const confirm: PendingElicitation = { server: "supabase", message: "This SQL is destructive. Run it?", fields: [] };
const form: PendingElicitation = {
  server: "s",
  message: "Fill it in",
  fields: [
    { name: "name", title: "Name", description: "Who", required: true, kind: "string" },
    { name: "age", title: "Age", required: false, kind: "integer" },
    { name: "ok", title: "Confirm", required: false, kind: "boolean" },
    { name: "color", title: "Color", required: true, kind: "enum", options: [{ value: "r", label: "Red" }, { value: "g", label: "Green" }] },
    { name: "size", title: "Size", required: false, kind: "enum", options: [{ value: "s", label: "Small" }], default: "s" },
    { name: "tags", title: "Tags", required: false, kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  ],
};

describe("initialAnswers", () => {
  it("starts each field at its default, an unticked box or an empty list", () => {
    expect(initialAnswers(form.fields)).toEqual({ name: "", age: "", ok: "false", color: "", size: "s", tags: "[]" });
  });
});

describe("ElicitationForm", () => {
  it("shows the server's message and answers a confirm with Accept or Decline", async () => {
    const onAnswer = vi.fn();
    render(<ElicitationForm elicitation={confirm} answered={false} readOnly={false} onAnswer={onAnswer} />);
    expect(screen.getByText("supabase")).toBeInTheDocument();
    expect(screen.getByText(/destructive/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true, undefined);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("sends the form's values with Submit", async () => {
    const onAnswer = vi.fn();
    render(<ElicitationForm elicitation={form} answered={false} readOnly={false} onAnswer={onAnswer} />);
    expect(screen.getByText("Who")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Name/), "Ann");
    await userEvent.type(screen.getByLabelText("Age"), "7");
    await userEvent.click(screen.getByLabelText("Confirm"));
    await userEvent.selectOptions(screen.getByLabelText(/Color/), "g");
    await userEvent.click(screen.getByLabelText("B"));
    await userEvent.click(screen.getByLabelText("A"));
    await userEvent.click(screen.getByLabelText("B"));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onAnswer).toHaveBeenCalledWith(true, { name: "Ann", age: "7", ok: "true", color: "g", size: "s", tags: '["a"]' });
  });

  it("links a URL request, and hides the buttons where the thread is read-only", () => {
    render(<ElicitationForm elicitation={{ ...confirm, mode: "url", url: "https://x.test/auth" }} answered={false} readOnly onAnswer={vi.fn()} />);
    expect(screen.getByRole("link", { name: "https://x.test/auth" })).toHaveAttribute("href", "https://x.test/auth");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables the buttons once answered", () => {
    render(<ElicitationForm elicitation={confirm} answered readOnly={false} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});
