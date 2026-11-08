// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";
import { autoForCard } from "./AutoForCard";
import "./test-utils";

const pending = { id: "p", toolName: "Bash", title: "Bash: ls", input: { command: "ls" }, why: { category: "mode" as const, detail: "Default asks before Bash" } };
const card = (over: Partial<Card> = {}) => ({ id: "c1", backend: "claude", permissionMode: "default", pending, ...over }) as Card;

describe("autoForCard", () => {
  it("switches the card to Auto and allows the command", async () => {
    const setMode = vi.fn(() => Promise.resolve());
    const allow = vi.fn();
    render(<>{autoForCard(card(), false, setMode, allow)}</>);
    await userEvent.click(screen.getByRole("button", { name: "Auto on this card" }));
    expect(setMode).toHaveBeenCalledWith("c1", "auto");
    expect(allow).toHaveBeenCalled();
  });

  it("swallows a failed switch, still allowing the command", async () => {
    const allow = vi.fn();
    render(<>{autoForCard(card({ backend: "puku", permissionMode: "acceptEdits" }), false, () => Promise.reject(new Error("x")), allow)}</>);
    await userEvent.click(screen.getByRole("button", { name: "Auto on this card" }));
    expect(allow).toHaveBeenCalled();
  });

  it("isn't offered without a transport, off Bash, for a guard's prompt, on Codex, or already in Auto", () => {
    const setMode = () => Promise.resolve();
    expect(autoForCard(card(), false, undefined, () => {})).toBeUndefined();
    expect(autoForCard(card({ pending: { ...pending, toolName: "Edit" } }), false, setMode, () => {})).toBeUndefined();
    expect(autoForCard(card({ pending: { ...pending, why: { category: "outside", detail: "x" } } }), false, setMode, () => {})).toBeUndefined();
    expect(autoForCard(card({ backend: "codex" }), false, setMode, () => {})).toBeUndefined();
    expect(autoForCard(card({ permissionMode: "auto" }), false, setMode, () => {})).toBeUndefined();
    expect(autoForCard(card({ pending: undefined }), false, setMode, () => {})).toBeUndefined();
  });
});
