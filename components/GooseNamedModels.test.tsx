// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { resetNamedModels } from "@/lib/use-named-models";
import GooseNamedModels from "./GooseNamedModels";
import "./test-utils";

const mocks = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api: { saveSettings: mocks.saveSettings } }));

/** The settings route answering with a chosen provider and the names it holds. */
function respond(body: unknown) {
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response));
}

describe("GooseNamedModels", () => {
  it("says so when no model is named", async () => {
    resetNamedModels();
    vi.stubGlobal("fetch", respond({ gooseProviderId: "openrouter", gooseNamedModels: [] }));
    render(<GooseNamedModels />);
    expect(await screen.findByText(/No models named yet/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows the names the server holds", async () => {
    resetNamedModels();
    vi.stubGlobal(
      "fetch",
      respond({ gooseProviderId: "openrouter", gooseNamedModels: [{ id: "anthropic/claude-opus-4.1", name: "Big Opus" }] }),
    );
    render(<GooseNamedModels />);
    expect(await screen.findByDisplayValue("Big Opus")).toBeInTheDocument();
    expect(screen.getByDisplayValue("anthropic/claude-opus-4.1")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("saves a new name, dropping the rows that are blank", async () => {
    resetNamedModels();
    vi.stubGlobal("fetch", respond({ gooseProviderId: "openrouter", gooseNamedModels: [] }));
    mocks.saveSettings.mockResolvedValue({});
    render(<GooseNamedModels />);
    await screen.findByText(/No models named yet/);

    await userEvent.click(screen.getByRole("button", { name: "Name another model" }));
    await userEvent.type(screen.getByLabelText("Model id for the new name"), "puku-ai-2.8");
    await userEvent.type(screen.getByLabelText("Name for puku-ai-2.8"), "Puku 2.8");
    await userEvent.click(screen.getByRole("button", { name: "Save the model names" }));

    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ gooseNamedModels: [{ id: "puku-ai-2.8", name: "Puku 2.8" }] }),
    );
    vi.unstubAllGlobals();
  });

  it("offers the provider's own model ids as suggestions", async () => {
    resetNamedModels();
    vi.stubGlobal("fetch", respond({ gooseProviderId: "openrouter", gooseNamedModels: [] }));
    const { container } = render(<GooseNamedModels />);
    await screen.findByText(/No models named yet/);
    await userEvent.click(screen.getByRole("button", { name: "Name another model" }));
    const datalist = container.querySelector("datalist#goose-model-ids");
    expect(datalist?.querySelectorAll("option").length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("says why when the save failed", async () => {
    resetNamedModels();
    vi.stubGlobal("fetch", respond({ gooseProviderId: "openrouter", gooseNamedModels: [] }));
    mocks.saveSettings.mockRejectedValue(new Error("offline"));
    render(<GooseNamedModels />);
    await screen.findByText(/No models named yet/);
    await userEvent.click(screen.getByRole("button", { name: "Name another model" }));
    await userEvent.click(screen.getByRole("button", { name: "Save the model names" }));
    expect(await screen.findByText(/Couldn’t save: offline/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("refreshes the names the board's pickers read, so a save shows up in the menu", async () => {
    // The model menus read the names from the board's store, so a save that doesn't re-read them
    // leaves every picker showing the old names until the board reloads.
    resetNamedModels();
    const fetch = respond({ gooseProviderId: "openrouter", gooseNamedModels: [] });
    vi.stubGlobal("fetch", fetch);
    mocks.saveSettings.mockResolvedValue({});
    render(<GooseNamedModels />);
    await screen.findByText(/No models named yet/);
    const callsBeforeSave = fetch.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Name another model" }));
    await userEvent.click(screen.getByRole("button", { name: "Save the model names" }));

    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(callsBeforeSave));
    vi.unstubAllGlobals();
  });
});
