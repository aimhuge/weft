// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DictationSettingsView } from "@/lib/dictation-types";

const api = vi.hoisted(() => ({ dictationSettings: vi.fn(), setDictationSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

const { default: DictationSettings, advancedLine } = await import("./DictationSettings");

function view(over: Partial<DictationSettingsView> = {}): DictationSettingsView {
  return {
    prefs: { language: "system", advanced: false, vocabulary: "" },
    server: false,
    model: undefined,
    download: { downloading: false, received: 0, total: 0 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.dictationSettings.mockResolvedValue(view());
  api.setDictationSettings.mockResolvedValue(view());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DictationSettings", () => {
  it("shows nothing until the settings arrive", () => {
    api.dictationSettings.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DictationSettings />);
    expect(container.textContent).toBe("");
  });

  it("renders the language picker with the saved language", async () => {
    api.dictationSettings.mockResolvedValue(view({ prefs: { language: "fr", advanced: false, vocabulary: "" } }));
    render(<DictationSettings />);
    const select = await screen.findByLabelText<HTMLSelectElement>("Dictation language");
    expect(select.value).toBe("fr");
    expect(screen.getByRole("option", { name: "System language" })).toBeTruthy();
  });

  it("saves the language when it is picked", async () => {
    render(<DictationSettings />);
    const select = await screen.findByLabelText<HTMLSelectElement>("Dictation language");
    fireEvent.change(select, { target: { value: "es" } });
    await waitFor(() => expect(api.setDictationSettings).toHaveBeenCalledWith({ language: "es" }));
  });

  it("shows the saved vocabulary in the box", async () => {
    api.dictationSettings.mockResolvedValue(view({ prefs: { language: "system", advanced: false, vocabulary: "Weft, Supabase" } }));
    render(<DictationSettings />);
    const box = await screen.findByLabelText("Dictation vocabulary");
    expect((box as HTMLTextAreaElement).value).toBe("Weft, Supabase");
  });

  it("saves the vocabulary when the box loses focus", async () => {
    render(<DictationSettings />);
    const box = await screen.findByLabelText("Dictation vocabulary");
    fireEvent.change(box, { target: { value: "Weft, puku-cli" } });
    fireEvent.blur(box);
    await waitFor(() => expect(api.setDictationSettings).toHaveBeenCalledWith({ vocabulary: "Weft, puku-cli" }));
  });

  it("saves nothing when the vocabulary hasn't changed", async () => {
    render(<DictationSettings />);
    const box = await screen.findByLabelText("Dictation vocabulary");
    fireEvent.blur(box);
    expect(api.setDictationSettings).not.toHaveBeenCalled();
  });

  it("shows the Advanced dictation switch as off by default", async () => {
    render(<DictationSettings />);
    const toggle = await screen.findByRole("switch", { name: "Advanced dictation" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("turns Advanced dictation on", async () => {
    render(<DictationSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Advanced dictation" }));
    await waitFor(() => expect(api.setDictationSettings).toHaveBeenCalledWith({ advanced: true }));
  });

  it("shows why a setting couldn't be saved", async () => {
    api.setDictationSettings.mockRejectedValue(new Error("Keep the vocabulary under 600 characters."));
    render(<DictationSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Advanced dictation" }));
    expect(await screen.findByText("Keep the vocabulary under 600 characters.")).toBeTruthy();
  });

  it("stringifies a failure that isn't an Error", async () => {
    api.setDictationSettings.mockRejectedValue("offline");
    render(<DictationSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Advanced dictation" }));
    expect(await screen.findByText("offline")).toBeTruthy();
  });

  it("keeps quiet when the settings can't be loaded", async () => {
    api.dictationSettings.mockRejectedValue(new Error("server down"));
    const { container } = render(<DictationSettings />);
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  it("asks again every second while the model downloads", async () => {
    vi.useFakeTimers();
    api.dictationSettings.mockResolvedValue(view({ download: { downloading: true, received: 1024, total: 2048 } }));
    render(<DictationSettings />);
    await act(async () => {});
    expect(api.dictationSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(api.dictationSettings).toHaveBeenCalledTimes(2);
    // The line follows the download's progress.
    expect(screen.getByText("Downloading the model: 0 of 0 MB")).toBeTruthy();
    // The fresh answer replaces the old one.
    api.dictationSettings.mockResolvedValue(view({ download: { downloading: true, received: 5 * 1024 * 1024, total: 10 * 1024 * 1024 } }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(screen.getByText("Downloading the model: 5 of 10 MB")).toBeTruthy();
  });

  it("keeps the last answer when a poll fails", async () => {
    vi.useFakeTimers();
    api.dictationSettings.mockResolvedValue(view({ download: { downloading: true, received: 1024, total: 2048 } }));
    render(<DictationSettings />);
    await act(async () => {});
    api.dictationSettings.mockRejectedValue(new Error("server down"));
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(screen.getByText("Downloading the model: 0 of 0 MB")).toBeTruthy();
  });

  it("shows a failed download in red", async () => {
    api.dictationSettings.mockResolvedValue(
      view({ download: { downloading: false, received: 0, total: 0, error: "The model download was cut off." } }),
    );
    render(<DictationSettings />);
    const line = await screen.findByText("The model download was cut off.");
    expect(line.className).toContain("text-danger");
  });

  it("shows the download's progress in the ordinary colour", async () => {
    api.dictationSettings.mockResolvedValue(view({ download: { downloading: true, received: 1024, total: 2048 } }));
    render(<DictationSettings />);
    const line = await screen.findByText("Downloading the model: 0 of 0 MB");
    expect(line.className).toContain("text-muted");
  });
});

describe("advancedLine", () => {
  const MB = 1024 * 1024;

  it("shows how much of the model has come down", () => {
    expect(advancedLine(view({ download: { downloading: true, received: 50 * MB, total: 550 * MB } }))).toBe(
      "Downloading the model: 50 of 550 MB",
    );
  });

  it("shows how much has come down when the size isn't known yet", () => {
    expect(advancedLine(view({ download: { downloading: true, received: 50 * MB, total: 0 } }))).toBe("Downloading the model: 50 MB");
  });

  it("shows the download's error", () => {
    expect(advancedLine(view({ download: { downloading: false, received: 0, total: 0, error: "The model download was cut off." } }))).toBe(
      "The model download was cut off.",
    );
  });

  it("says nothing when Advanced dictation is off", () => {
    expect(advancedLine(view())).toBe("");
  });

  it("asks for whisper-server when Advanced dictation is on without it", () => {
    expect(advancedLine(view({ prefs: { language: "system", advanced: true, vocabulary: "" } }))).toBe(
      "Needs whisper-server: brew install whisper-cpp",
    );
  });

  it("names the model in use", () => {
    expect(
      advancedLine(
        view({
          prefs: { language: "system", advanced: true, vocabulary: "" },
          server: true,
          model: "ggml-large-v3-turbo-q5_0.bin",
        }),
      ),
    ).toBe("Using ggml-large-v3-turbo-q5_0.bin");
  });

  it("says nothing when Advanced dictation is on with a server but no model", () => {
    expect(advancedLine(view({ prefs: { language: "system", advanced: true, vocabulary: "" }, server: true }))).toBe("");
  });
});
