// @vitest-environment jsdom
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { PillBridge, PillDelivery, PillUpdate } from "@/lib/client";

type FakeState = { state: PillUpdate["state"]; seconds: number; level: number; error: string | null };

const fake = vi.hoisted(() => ({
  onText: null as null | ((text: string) => void),
  set: null as null | ((patch: Partial<FakeState>) => void),
  toggle: vi.fn(),
  cancel: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock("@/lib/use-dictation", async () => {
  const React = await import("react");
  return {
    useDictation: (onText: (text: string) => void) => {
      fake.onText = onText;
      const [s, set] = React.useState<FakeState>({ state: "idle", seconds: 0, level: 0, error: null });
      fake.set = (patch) => set((v) => ({ ...v, ...patch }));
      return { ...s, toggle: fake.toggle, cancel: fake.cancel, clearError: fake.clearError };
    },
  };
});

const chimes = vi.hoisted(() => ({ playDictationChime: vi.fn() }));
vi.mock("@/lib/dictation-chimes", () => chimes);

const api = vi.hoisted(() => ({ dictationSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

const { default: DictationPill, FLASH_MS, ERROR_MS } = await import("./DictationPill");

let command: ((c: "toggle" | "cancel") => void) | null;
let pill: { [K in keyof PillBridge]: ReturnType<typeof vi.fn> };
const unsubscribe = vi.fn();

function settings(sounds: boolean) {
  return { prefs: { language: "system", advanced: false, vocabulary: "", sounds } };
}

function set(patch: Partial<FakeState>) {
  act(() => fake.set!(patch));
}

function send(c: "toggle" | "cancel") {
  act(() => command!(c));
}

async function flush() {
  await act(async () => {});
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount() {
  const view = render(<DictationPill />);
  await flush();
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  command = null;
  api.dictationSettings.mockResolvedValue(settings(true));
  pill = {
    onCommand: vi.fn((cb: (c: "toggle" | "cancel") => void) => {
      command = cb;
      return unsubscribe;
    }),
    state: vi.fn(),
    text: vi.fn(),
    hide: vi.fn(),
  };
  window.weftPill = pill as unknown as PillBridge;
  document.documentElement.style.background = "";
  document.body.style.background = "";
});

afterEach(() => {
  delete window.weftPill;
  vi.useRealTimers();
});

describe("DictationPill", () => {
  it("makes the page background transparent", async () => {
    await mount();
    expect(document.documentElement.style.background).toBe("transparent");
    expect(document.body.style.background).toBe("transparent");
  });

  it("renders nothing at idle and leaves a fresh page alone", async () => {
    vi.useFakeTimers();
    const { container } = render(<DictationPill />);
    await flush();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.firstElementChild?.childNodes.length).toBe(0);
    expect(pill.hide).not.toHaveBeenCalled();
  });

  it("survives settings that fail to load", async () => {
    api.dictationSettings.mockRejectedValue(new Error("down"));
    await mount();
    set({ state: "recording" });
    expect(chimes.playDictationChime).toHaveBeenCalledWith("start");
  });

  it("toggles on a toggle command and cancels on a cancel command", async () => {
    await mount();
    send("toggle");
    expect(fake.toggle).toHaveBeenCalledTimes(1);
    expect(fake.cancel).not.toHaveBeenCalled();
    send("cancel");
    expect(fake.cancel).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from commands on unmount", async () => {
    const { unmount } = await mount();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("works without a pill bridge", async () => {
    delete window.weftPill;
    const { container } = await mount();
    set({ state: "recording", seconds: 3 });
    expect(screen.getByText("0:03")).toBeInTheDocument();
    set({ state: "idle" });
    expect(container.textContent).toBe("");
  });

  // Known bug: with no weftPill, `window.weftPill?.text(text)` short-circuits the whole chain, so the .finally that
  // clears `sending` never runs and the pill shows "Transcribing…" for good. Flip to `it` once it's fixed.
  it("lets go of Transcribing… when there's no pill bridge to take the text", async () => {
    delete window.weftPill;
    const { container } = await mount();
    act(() => fake.onText!("hello"));
    await flush();
    expect(container.textContent).toBe("");
  });

  it("shows the stop button with the time while recording, and clicking it toggles", async () => {
    await mount();
    send("toggle");
    set({ state: "recording", seconds: 75, level: 0.5 });
    const stop = screen.getByRole("button", { name: "Stop dictation" });
    expect(stop).toHaveTextContent("1:15");
    fireEvent.click(stop);
    expect(fake.toggle).toHaveBeenCalledTimes(2);
  });

  it("chimes as recording starts and as it stops", async () => {
    await mount();
    set({ state: "recording" });
    expect(chimes.playDictationChime).toHaveBeenLastCalledWith("start");
    set({ state: "transcribing" });
    expect(chimes.playDictationChime).toHaveBeenLastCalledWith("stop");
    set({ state: "idle" });
    expect(chimes.playDictationChime).toHaveBeenCalledTimes(2);
  });

  it("stays silent when sounds are off", async () => {
    api.dictationSettings.mockResolvedValue(settings(false));
    await mount();
    set({ state: "recording" });
    set({ state: "idle" });
    expect(chimes.playDictationChime).not.toHaveBeenCalled();
  });

  it("reports its state and time to main", async () => {
    await mount();
    expect(pill.state).toHaveBeenLastCalledWith({ state: "idle", seconds: 0, level: 0 });
    set({ state: "recording", seconds: 2, level: 0.3 });
    expect(pill.state).toHaveBeenLastCalledWith({ state: "recording", seconds: 2, level: 0.3 });
  });

  it("sends loudness at most every 100 ms for the same state and time", async () => {
    vi.useFakeTimers();
    render(<DictationPill />);
    await flush();
    set({ state: "recording", seconds: 1, level: 0.1 });
    const calls = pill.state.mock.calls.length;
    set({ level: 0.2 });
    expect(pill.state).toHaveBeenCalledTimes(calls);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    set({ level: 0.3 });
    expect(pill.state).toHaveBeenLastCalledWith({ state: "recording", seconds: 1, level: 0.3 });
  });

  it.each<[PillDelivery, string]>([
    ["inserted", "Pasted"],
    ["pasted", "Pasted"],
    ["copied", "Copied"],
    ["no-access", "Copied · allow Accessibility to paste"],
  ])("hands the text to main, says %s as %s, then hides", async (delivery, line) => {
    vi.useFakeTimers();
    const sent = deferred<PillDelivery>();
    pill.text.mockReturnValue(sent.promise);
    render(<DictationPill />);
    await flush();
    send("toggle");
    set({ state: "recording" });
    set({ state: "transcribing" });
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();
    act(() => fake.onText!("hello world"));
    set({ state: "idle" });
    expect(pill.text).toHaveBeenCalledWith("hello world");
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(FLASH_MS * 3);
    });
    expect(pill.hide).not.toHaveBeenCalled();
    sent.resolve(delivery);
    await flush();
    expect(screen.getByText(line)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(FLASH_MS - 1);
    });
    expect(pill.hide).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(pill.hide).toHaveBeenCalledTimes(1);
    expect(fake.clearError).toHaveBeenCalled();
    expect(screen.queryByText(line)).not.toBeInTheDocument();
  });

  it("says Copied when main fails to take the text", async () => {
    const sent = deferred<PillDelivery>();
    pill.text.mockReturnValue(sent.promise);
    await mount();
    send("toggle");
    act(() => fake.onText!("hello"));
    sent.reject(new Error("gone"));
    await flush();
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("shows an error, then hides after ERROR_MS and clears it", async () => {
    vi.useFakeTimers();
    render(<DictationPill />);
    await flush();
    send("toggle");
    set({ error: "Weft can't use the microphone." });
    expect(screen.getByTitle("Weft can't use the microphone.")).toHaveTextContent("Weft can't use the microphone.");
    act(() => {
      vi.advanceTimersByTime(ERROR_MS - 1);
    });
    expect(pill.hide).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(pill.hide).toHaveBeenCalledTimes(1);
    expect(fake.clearError).toHaveBeenCalledTimes(1);
  });

  it("doesn't show an error on a page nobody asked to do anything", async () => {
    const { container } = await mount();
    set({ error: "Mic broke" });
    expect(container.textContent).toBe("");
  });

  it("hides right away on cancel when there's nothing to say", async () => {
    vi.useFakeTimers();
    render(<DictationPill />);
    await flush();
    send("cancel");
    expect(fake.cancel).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(pill.hide).toHaveBeenCalledTimes(1);
  });

  it("drops the last word when a new command comes in", async () => {
    pill.text.mockResolvedValue("copied");
    await mount();
    send("toggle");
    act(() => fake.onText!("hi"));
    await flush();
    expect(screen.getByText("Copied")).toBeInTheDocument();
    send("toggle");
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
