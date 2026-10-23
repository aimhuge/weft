// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsView } from "@/lib/types";
import SettingsDialog from "./SettingsDialog";
import "./test-utils";

const api = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
// The pages' own pickers have their own tests; here they only need to show up on the right page.
vi.mock("./AppearancePicker", () => ({ default: () => <p>appearance picker</p> }));
vi.mock("./AccountSettings", () => ({ default: () => <p>account settings</p> }));
vi.mock("./CliLogins", () => ({ default: () => <p>cli logins</p> }));
vi.mock("./SubagentPicker", () => ({ default: () => <p>subagent picker</p> }));
vi.mock("./DonePicker", () => ({ default: () => <p>done picker</p> }));
vi.mock("./TrustedFolders", () => ({ default: () => <p>trusted folders</p> }));
vi.mock("./TokenExpiry", () => ({ default: () => <p>token expiry</p> }));
vi.mock("./AutomationSettings", () => ({ default: () => <p>automation rules</p> }));
// LaptopModeCard is a thin wrapper around the keep-working IPC bridge; it has its own focused test
// (LaptopModeCard.test.tsx). Here it just needs to render on its own page.
vi.mock("./LaptopModeCard", () => ({ default: () => <p>laptop mode card</p> }));
// TeamSettings is a real component but reads from lib/use-team, which would need a board-side
// data fetch. Here it just needs to be reachable without throwing.
vi.mock("./TeamSettings", () => ({ default: () => <p>team settings</p> }));
// SyncSettings is the real component on the new "sync" page; it has its own test. Here it just
// needs to render so we can reach the page without firing useCloudSync / useAccount.
vi.mock("./SyncSettings", () => ({ default: () => <p>sync settings</p> }));

const SETTINGS: SettingsView = {
  threadPrompt: "be nice",
  defaultThreadPrompt: "be nice",
  keepAliveMinutes: 0,
  defaultPermissionMode: "auto",
  defaultBackend: "claude",
  automations: [],
  pushOnDone: false,
  subagentModel: "choose",
  doneModel: "",
  doneEffort: "",
  copilotModel: "",
  reviewAllModel: "",
  backupModel: "",
  projects: [],
  issueFolders: [],
  syncFolders: [],
  allowedFolders: [],
};

beforeEach(() => {
  localStorage.clear();
  api.settings.mockReset().mockResolvedValue(SETTINGS);
  api.saveSettings.mockReset().mockResolvedValue({});
});

const pages = () => screen.getByRole("navigation", { name: "Settings pages" });
const go = (name: string) => userEvent.click(within(pages()).getByRole("button", { name }));

describe("SettingsDialog", () => {
  it("puts a scene behind it and shows one page at a time", async () => {
    render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByRole("dialog").style.background).toContain("/api/scenes/salt-flats");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("appearance picker")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show backlog" })).toBeInTheDocument();

    await go("Accounts");
    expect(screen.getByText("account settings")).toBeInTheDocument();
    expect(screen.getByText("cli logins")).toBeInTheDocument();
    expect(screen.queryByText("token expiry")).not.toBeInTheDocument();
    expect(screen.queryByText("appearance picker")).not.toBeInTheDocument();

    await go("Security");
    expect(await screen.findByText("trusted folders")).toBeInTheDocument();
    expect(screen.getByText("token expiry")).toBeInTheDocument();
    expect(screen.getByText("Default permission mode")).toBeInTheDocument();

    await go("Shortcuts");
    expect(screen.getByRole("heading", { name: "Shortcuts", level: 2 })).toBeInTheDocument();
  });

  it("keeps every model choice on Models, and marks an unsaved CLI pick", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await go("Models");
    const cli = await screen.findByRole("combobox", { name: "Default CLI" });
    expect(screen.getByText("subagent picker")).toBeInTheDocument();
    expect(screen.getByText("done picker")).toBeInTheDocument();
    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();

    // The model and effort are the New thread dialog's remembered picks, so they change right away.
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default model" }), "claude-haiku-5-5");
    expect(localStorage.getItem("weft.model.claude")).toBe("claude-haiku-5-5");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default effort" }), "low");
    expect(localStorage.getItem("weft.effort")).toBe("low");

    await userEvent.selectOptions(cli, "puku");
    expect(within(pages()).getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("opus-4.8");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.saveSettings).toHaveBeenCalledWith({ defaultBackend: "puku" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says when the settings didn't load, on the pages that need them", async () => {
    api.settings.mockRejectedValue(new Error("offline"));
    render(<SettingsDialog onClose={() => {}} />);
    await go("Automations");
    expect(await screen.findByText("Couldn't load settings: offline")).toBeInTheDocument();
  });

  it("closes when the scene background is clicked, but not the panes on top of it", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    // The full-panel wrapper is what the dialog listens on for backdrop clicks; the header, nav,
    // cards, and footer stop the event so their own clicks keep working.
    const dialog = screen.getByRole("dialog");
    // dialog > wrapper (CrashGuard's catchError wrapper renders its children directly when nothing
    // throws, so the SettingsDialog's full-panel div is the dialog's first child).
    const background = dialog.firstElementChild as HTMLElement;
    expect(background).toBeTruthy();
    fireEvent.mouseDown(background);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clicking a nav button switches the page and doesn't close.
    onClose.mockClear();
    await go("Shortcuts");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Shortcuts", level: 2 })).toBeInTheDocument();

    // Clicking inside a card (a switch on General) doesn't close.
    await go("General");
    onClose.mockClear();
    await userEvent.click(screen.getByRole("switch", { name: "Show backlog" }));
    expect(onClose).not.toHaveBeenCalled();

    // The footer buttons close (Cancel) or save (Save) — Cancel calls onClose directly.
    onClose.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the Teams page from the nav", async () => {
    render(<SettingsDialog onClose={() => {}} />);
    await go("Teams");
    expect(screen.getByText("team settings")).toBeInTheDocument();
  });

  it("gives the Laptop mode card its own page", async () => {
    render(<SettingsDialog onClose={() => {}} />);
    // The page is whatever was last open in this test run; the card has its own page, so go there
    // before checking, and make sure it isn't on General.
    await go("Laptop mode");
    expect(screen.getByText("laptop mode card")).toBeInTheDocument();
    await go("General");
    expect(screen.queryByText("laptop mode card")).not.toBeInTheDocument();
  });
});
