// @vitest-environment jsdom
// Voice mode's bar (components/VoiceBar.tsx): Space or a click to talk, Space again to send, Esc to drop it.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DictationState } from "@/lib/use-dictation";
import "./test-utils";
import VoiceBar from "./VoiceBar";

function recorder(state: DictationState = "idle", more: Partial<{ error: string | null; opening: boolean; seconds: number }> = {}) {
  return { state, error: null, seconds: 0, level: 0.5, opening: false, clearError: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), ...more };
}

describe("VoiceBar", () => {
  it("reads Press Space to talk; Space and a click both start", () => {
    const r = recorder();
    render(<VoiceBar recorder={r} />);
    const bar = screen.getByRole("button", { name: "Press Space to talk" });
    expect(bar).toHaveTextContent("Press Space to talk");
    fireEvent.keyDown(bar, { key: " " });
    fireEvent.click(bar);
    expect(r.toggle).toHaveBeenCalledTimes(2);
  });

  it("while listening shows the time and how to send or cancel; Space stops and sends, Esc cancels", () => {
    const r = recorder("recording", { seconds: 65 });
    render(<VoiceBar recorder={r} />);
    const bar = screen.getByRole("button", { name: "Stop and send" });
    expect(bar).toHaveTextContent("1:05");
    expect(bar).toHaveTextContent("Space to send · Esc to cancel");
    fireEvent.keyDown(bar, { key: " " });
    expect(r.toggle).toHaveBeenCalledOnce();
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(r.cancel).toHaveBeenCalledOnce();
    // A held Space repeats without stopping twice; other keys pass.
    fireEvent.keyDown(bar, { key: " ", repeat: true });
    fireEvent.keyDown(bar, { key: "a" });
    fireEvent.keyUp(bar, { key: " " });
    fireEvent.keyUp(bar, { key: "a" });
    expect(r.toggle).toHaveBeenCalledOnce();
  });

  it("says the mic is opening", () => {
    render(<VoiceBar recorder={recorder("recording", { opening: true })} />);
    expect(screen.getByRole("button")).toHaveTextContent("Opening mic…");
  });

  it("spins while transcribing and ignores Space and clicks then", () => {
    const r = recorder("transcribing");
    render(<VoiceBar recorder={r} />);
    const bar = screen.getByRole("button");
    expect(bar).toHaveTextContent("Sending what you said…");
    expect(bar).toHaveAttribute("aria-busy", "true");
    fireEvent.keyDown(bar, { key: " " });
    fireEvent.click(bar);
    expect(r.toggle).not.toHaveBeenCalled();
  });

  it("shows the recorder's error", () => {
    render(<VoiceBar recorder={recorder("idle", { error: "Microphone blocked" })} />);
    expect(screen.getByRole("button")).toHaveTextContent("Microphone blocked");
  });
});
