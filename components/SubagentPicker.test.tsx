// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubagentPicker from "./SubagentPicker";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("SubagentPicker", () => {
  it("shows the saved model and saves a new pick right away", async () => {
    render(<SubagentPicker value="choose" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    expect(select).toHaveValue("choose");
    expect(screen.getByRole("group", { name: "Claude Code" })).toHaveTextContent("Fable 5.1");
    expect(screen.getByRole("group", { name: "puku-cli" })).toHaveTextContent("Opus 4.8");
    await userEvent.selectOptions(select, "opus-4.8");
    expect(api.saveSettings).toHaveBeenCalledWith({ subagentModel: "opus-4.8" });
    expect(select).toHaveValue("opus-4.8");
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<SubagentPicker value="claude-sonnet-5-5" />);
    const select = screen.getByRole("combobox", { name: "Use for subagents" });
    await userEvent.selectOptions(select, "claude-opus-5-5");
    await waitFor(() => expect(select).toHaveValue("claude-sonnet-5-5"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
