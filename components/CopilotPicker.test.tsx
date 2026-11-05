// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CopilotPicker from "./CopilotPicker";
import { openModels, pickModel } from "./model-picker-test-utils";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("CopilotPicker", () => {
  it("offers every model and saves a new pick right away", () => {
    render(<CopilotPicker value="claude-opus-5-5" />);
    const select = screen.getByRole("combobox", { name: "Model for the copilot" });
    expect(select).toHaveValue("Opus 5.5");
    // Every CLI's models are here: picking one moves the copilot to the CLI that serves it.
    const list = openModels("Model for the copilot");
    expect(within(list).getByRole("group", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: /^Codex/ })).toBeInTheDocument();
    pickModel("Model for the copilot", "Sonnet 5.5");
    expect(api.saveSettings).toHaveBeenCalledWith({ copilotModel: "claude-sonnet-5-5" });
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<CopilotPicker value="claude-sonnet-5-5" />);
    const select = screen.getByRole("combobox", { name: "Model for the copilot" });
    pickModel("Model for the copilot", "Opus 5.5");
    await waitFor(() => expect(select).toHaveValue("Sonnet 5.5"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
