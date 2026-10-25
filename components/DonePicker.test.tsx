// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DonePicker from "./DonePicker";
import "./test-utils";

const api = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => {
  api.saveSettings.mockReset().mockResolvedValue({});
});

describe("DonePicker", () => {
  it("shows the saved model and effort and saves each change right away", async () => {
    render(<DonePicker model="claude-opus-5-5" effort="xhigh" />);
    const model = screen.getByRole("combobox", { name: "Model for /weft:done" });
    const effort = screen.getByRole("combobox", { name: "Effort for /weft:done" });
    expect(model).toHaveValue("claude-opus-5-5");
    expect(effort).toHaveValue("xhigh");
    await userEvent.selectOptions(model, "claude-sonnet-5-5");
    expect(api.saveSettings).toHaveBeenCalledWith({ doneModel: "claude-sonnet-5-5" });
    expect(model).toHaveValue("claude-sonnet-5-5");
    await userEvent.selectOptions(effort, "low");
    expect(api.saveSettings).toHaveBeenCalledWith({ doneEffort: "low" });
    expect(effort).toHaveValue("low");
  });

  it("starts on 'Card's own' (empty id) for both selects when the setting is unset", () => {
    render(<DonePicker model="" effort="" />);
    const model = screen.getByRole("combobox", { name: "Model for /weft:done" });
    const effort = screen.getByRole("combobox", { name: "Effort for /weft:done" });
    expect(model).toHaveValue("");
    expect(effort).toHaveValue("");
    expect(screen.getByRole("option", { name: "Card's own model" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Card's own effort" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Claude Code" })).toHaveTextContent("Fable 5.1");
    expect(screen.getByRole("group", { name: "puku-cli" })).toHaveTextContent("Opus 4.8");
  });

  it("saves a Puku model", async () => {
    render(<DonePicker model="" effort="" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Model for /weft:done" }), "opus-4.8");
    expect(api.saveSettings).toHaveBeenCalledWith({ doneModel: "opus-4.8" });
  });

  it("goes back and says why when the save fails", async () => {
    api.saveSettings.mockRejectedValue(new Error("offline"));
    render(<DonePicker model="claude-sonnet-5-5" effort="high" />);
    const model = screen.getByRole("combobox", { name: "Model for /weft:done" });
    await userEvent.selectOptions(model, "claude-opus-5-5");
    await waitFor(() => expect(model).toHaveValue("claude-sonnet-5-5"));
    expect(screen.getByText("Couldn’t save: offline")).toBeInTheDocument();
  });
});
