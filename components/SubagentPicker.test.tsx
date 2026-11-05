// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubagentPicker from "./SubagentPicker";
import { openModels, pickModel } from "./model-picker-test-utils";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("SubagentPicker", () => {
  it("shows the saved model and saves a new pick right away", () => {
    render(<SubagentPicker value="choose" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    expect(select).toHaveValue("Let the model choose");
    const list = openModels("Use for subagents");
    expect(within(list).getByRole("group", { name: "Claude Code" })).toHaveTextContent("Fable 5.1");
    expect(within(list).getByRole("group", { name: "puku-cli" })).toHaveTextContent("Opus 4.8");
    pickModel("Use for subagents", "Opus 4.8");
    expect(api.saveSettings).toHaveBeenCalledWith({ subagentModel: "opus-4.8" });
    expect(select).toHaveValue("Opus 4.8");
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<SubagentPicker value="claude-sonnet-5-5" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    pickModel("Use for subagents", "Opus 5.5");
    await waitFor(() => expect(select).toHaveValue("Sonnet 5.5"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
