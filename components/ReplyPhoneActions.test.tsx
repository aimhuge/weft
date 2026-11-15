// @vitest-environment jsdom
// The reply box's phone-look buttons (components/ReplyPhoneActions.tsx).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReplyModeView } from "@/lib/reply-mode";
import "./test-utils";
import ReplyPhoneActions from "./ReplyPhoneActions";

const SEND: ReplyModeView = { mode: "reply", tone: "accent", primary: { action: "send", label: "Send", tip: "Send (Enter)" }, menu: [] };

function setup(more: Partial<Parameters<typeof ReplyPhoneActions>[0]> = {}) {
  const onAction = vi.fn();
  const onStop = vi.fn();
  render(<ReplyPhoneActions view={SEND} live={false} sending={false} empty question={false} onAction={onAction} onStop={onStop} {...more} />);
  return { onAction, onStop };
}

describe("ReplyPhoneActions", () => {
  it("shows no Send for an empty box", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("Send ↑ does what Enter does once there is something to send", () => {
    const steer: ReplyModeView = { ...SEND, mode: "steer", primary: { action: "steer", label: "Send", tip: "after the next tool call" } };
    const { onAction } = setup({ empty: false, view: steer });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith("steer");
  });

  it("a waiting question shows Send with an empty box, spinning while it sends", () => {
    const answer: ReplyModeView = { ...SEND, primary: { action: "answer", label: "Answer", tip: "Answer" } };
    setup({ question: true, view: answer, sending: true });
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });

  it("Stop ■ while the turn runs", () => {
    const { onStop } = setup({ live: true });
    fireEvent.click(screen.getByRole("button", { name: "Stop the current turn" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("offers Continue and Done as words, and an empty box's Continue", () => {
    const view: ReplyModeView = {
      ...SEND,
      done: { action: "done", label: "Done", tip: "wrap up" },
      cont: { action: "continue", label: "Continue", tip: "keep going", keys: "mod+shift+Enter" },
    };
    const { onAction } = setup({ view });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAction.mock.calls).toEqual([["done"], ["continue"]]);
  });

  it("an empty box after a cut-off turn offers its Continue primary as a word", () => {
    const view: ReplyModeView = { ...SEND, primary: { action: "continue", label: "Continue", tip: "pick up" } };
    const { onAction } = setup({ view });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAction).toHaveBeenCalledWith("continue");
  });
});
