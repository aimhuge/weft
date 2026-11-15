// @vitest-environment jsdom
// The Composer's phone look (simple mode's full-page pane): one rounded box, a row of round buttons, voice mode. The
// recorders are stand-ins: the first useDictation is the field's mic, the second voice mode's, whose words go out.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import Composer, { type ComposerHandle } from "./Composer";

const log = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/use-dictation", async () => {
  const { useRef, useState } = await import("react");
  return {
    useDictation: (onText: (text: string) => void) => {
      const [state, setState] = useState<"idle" | "recording">("idle");
      const phase = useRef(state);
      const said = useRef(onText);
      said.current = onText;
      const set = (next: "idle" | "recording") => {
        phase.current = next;
        setState(next);
      };
      return {
        state,
        error: null,
        seconds: 0,
        level: 0,
        opening: false,
        clearError: () => {},
        toggle: () => {
          log.push("toggle");
          if (phase.current === "idle") {
            set("recording");
            return;
          }
          set("idle");
          said.current("ship it");
        },
        cancel: () => {
          log.push("cancel");
          set("idle");
        },
      };
    },
  };
});

// ProseMirror measures the cursor to scroll it into view; jsdom has no layout, so nothing to measure.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

beforeEach(() => {
  localStorage.clear();
  log.length = 0;
});

function setup(look?: "phone") {
  const ref = createRef<ComposerHandle>();
  const sent: string[] = [];
  const onVoiceSubmit = vi.fn(() => sent.push(ref.current?.read() ?? ""));
  render(
    <Composer
      ref={ref}
      variant="reply"
      look={look}
      placeholder="Reply…"
      sizeClass=""
      onSubmit={() => {}}
      onVoiceSubmit={onVoiceSubmit}
      modelPicker={<span>Opus picker</span>}
      actions={<button type="button">Send it</button>}
    />,
  );
  return { sent, onVoiceSubmit };
}

describe("the Composer's phone look", () => {
  it("drops the format, Markdown and model controls and keeps ＋, mic, 〰 and the actions", () => {
    setup("phone");
    expect(screen.queryByRole("button", { name: "Formatting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit as Markdown" })).toBeNull();
    expect(screen.queryByText("Opus picker")).toBeNull();
    expect(screen.getByRole("button", { name: "Attach images, videos, or files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dictate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voice mode/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send it" })).toBeInTheDocument();
    expect(document.querySelector(".composer")).toHaveClass("rounded-3xl");
  });

  it("without the look, renders as it always has", () => {
    setup();
    expect(screen.getByRole("button", { name: "Formatting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit as Markdown" })).toBeInTheDocument();
    expect(screen.getByText("Opus picker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Voice mode/ })).toBeNull();
    expect(document.querySelector(".composer")).toHaveClass("rounded-lg");
  });

  it("〰 turns voice mode on and remembers it; ⌨ turns it off", () => {
    setup("phone");
    fireEvent.click(screen.getByRole("button", { name: /Voice mode/ }));
    expect(localStorage.getItem("weft-voice-mode")).toBe("1");
    expect(screen.getByRole("button", { name: "Press Space to talk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
    expect(localStorage.getItem("weft-voice-mode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Press Space to talk" })).toBeNull();
  });

  it("opens in voice mode once it's on; Space talks and Space again sends what was said", async () => {
    localStorage.setItem("weft-voice-mode", "1");
    const { sent, onVoiceSubmit } = setup("phone");
    // TipTap builds its editor after the first render.
    await act(async () => {});
    const bar = screen.getByRole("button", { name: "Press Space to talk" });
    fireEvent.keyDown(bar, { key: " " });
    expect(screen.getByRole("button", { name: "Stop and send" })).toHaveTextContent("Space to send · Esc to cancel");
    fireEvent.keyDown(bar, { key: " " });
    expect(onVoiceSubmit).toHaveBeenCalledOnce();
    expect(sent).toEqual(["ship it"]);
  });

  it("Esc drops what was being said", () => {
    localStorage.setItem("weft-voice-mode", "1");
    const { onVoiceSubmit } = setup("phone");
    const bar = screen.getByRole("button", { name: "Press Space to talk" });
    fireEvent.keyDown(bar, { key: " " });
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(log).toEqual(["toggle", "cancel"]);
    expect(onVoiceSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Press Space to talk" })).toBeInTheDocument();
  });

  it("voice mode is the phone look's only: the regular composer ignores the pref", () => {
    localStorage.setItem("weft-voice-mode", "1");
    setup();
    expect(screen.queryByRole("button", { name: "Press Space to talk" })).toBeNull();
  });
});
