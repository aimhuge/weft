// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BackupModelPicker from "./BackupModelPicker";
import { api } from "@/lib/client";
import { openModels, pickModel } from "./model-picker-test-utils";
import "./test-utils";

vi.mock("@/lib/client", () => ({
  api: { saveSettings: vi.fn().mockResolvedValue({}) },
}));

beforeEach(() => {
  vi.mocked(api.saveSettings).mockClear();
});

describe("BackupModelPicker", () => {
  it("shows the leading 'Off — no backup' option as the default when value is empty", () => {
    render(<BackupModelPicker value="" />);
    expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveValue("Off — no backup");
    // The leading option is the first row of the list.
    expect(within(openModels("Backup model")).getAllByRole("option")[0]).toHaveTextContent("Off — no backup");
  });

  it("reflects the saved value as the selected option", () => {
    render(<BackupModelPicker value="claude-sonnet-5-5" />);
    expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveValue("Sonnet 5.5");
  });

  it("saves the picked model through api.saveSettings on change", async () => {
    render(<BackupModelPicker value="claude-sonnet-5-5" />);
    pickModel("Backup model", "Haiku 5.5");
    await waitFor(() => {
      expect(api.saveSettings).toHaveBeenCalledWith({ backupModel: "claude-haiku-5-5" });
    });
  });

  it("renders the explanatory copy that names the first-message-failed banner", () => {
    render(<BackupModelPicker value="claude-sonnet-5-5" />);
    expect(screen.getByText(/When the first message of a card comes back an error/)).toBeInTheDocument();
    expect(screen.getByText(/Pick .Off. to hide the rerun button/)).toBeInTheDocument();
  });

  it("uses 'Backup model' as the row heading", () => {
    render(<BackupModelPicker value="" />);
    expect(screen.getByRole("heading", { name: "Backup model" })).toBeInTheDocument();
  });
});
