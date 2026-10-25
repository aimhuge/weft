// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntakeResult } from "@/lib/project-intake";
import "./test-utils";

// The intake screen (components/IntakeDialog.tsx): opens from lib/intake-open.ts after a project's intake, lists what
// moved, the blanks with their provider links, the webhooks and the files to rotate, and hands the rest to a thread.

const create = vi.hoisted(() => vi.fn());
const openInPane = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client", () => ({ api: { create } }));
vi.mock("@/lib/open-in-pane", () => ({ openInPane }));

const { closeIntake, openIntake, useIntakeActions } = await import("@/lib/intake-open");
const { default: IntakeDialog } = await import("./IntakeDialog");

const openDrawer = vi.fn();
const select = vi.fn();

function Harness() {
  useIntakeActions(openDrawer, select);
  return <IntakeDialog />;
}

const FULL: IntakeResult = {
  imported: 2,
  importedFrom: [".env.local"],
  blanks: 1,
  hooks: 1,
  tracked: [".env"],
  details: {
    imported: [
      { name: "RESEND_API_KEY", file: ".env.local" },
      { name: "DATABASE_URL", file: ".env.local" },
    ],
    blanks: [{ name: "STRIPE_SECRET_KEY", source: "your code", hint: "Stripe → API keys: https://dashboard.stripe.com/apikeys (read in lib/pay.ts)" }],
    hooks: [{ name: "stripe", target: "/api/stripe/webhook", provider: "stripe", hint: "Stripe → Webhooks: https://dashboard.stripe.com/webhooks" }],
  },
};

afterEach(() => {
  act(() => closeIntake());
  create.mockReset();
  openInPane.mockReset();
  openDrawer.mockReset();
  select.mockReset();
});

function show(result: IntakeResult = FULL) {
  render(<Harness />);
  act(() => openIntake("/r/shop", result));
}

describe("IntakeDialog", () => {
  it("draws nothing until an intake opens it", () => {
    const { container } = render(<IntakeDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists what moved, the blanks, the webhooks and the file to rotate", () => {
    show();
    expect(screen.getByText("📥 Weft took in shop")).toBeInTheDocument();
    expect(screen.getByText("✓ Moved into 🔐 from .env.local")).toBeInTheDocument();
    expect(screen.getByText("RESEND_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("Blanks to fill in · 1")).toBeInTheDocument();
    expect(screen.getByText("· your code")).toBeInTheDocument();
    expect(screen.getByText("🪝 Webhooks to register · 1")).toBeInTheDocument();
    expect(screen.getByText("/api/stripe/webhook")).toBeInTheDocument();
    expect(screen.getByText(/\.env is committed to git, so its keys/)).toBeInTheDocument();
  });

  it("says 'their keys' when more than one file is committed", () => {
    show({ ...FULL, tracked: [".env", ".env.production"] });
    expect(screen.getByText(/are committed to git, so their keys/)).toBeInTheDocument();
  });

  it("closes before a hint's link opens in the pane, so the pane shows", async () => {
    show();
    await userEvent.click(screen.getAllByRole("link")[0]!);
    expect(openInPane).toHaveBeenCalledWith("https://dashboard.stripe.com/apikeys");
    expect(screen.queryByText("📥 Weft took in shop")).not.toBeInTheDocument();
  });

  it("opens 🔐 or 🪝 on the board and closes", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Open 🔐" }));
    expect(openDrawer).toHaveBeenCalledWith("vault");
    expect(screen.queryByText("📥 Weft took in shop")).not.toBeInTheDocument();
    act(() => openIntake("/r/shop", FULL));
    await userEvent.click(screen.getByRole("button", { name: "Open 🪝" }));
    expect(openDrawer).toHaveBeenCalledWith("webhooks");
  });

  it("starts a thread with the setup prompt in the project and opens its card", async () => {
    create.mockResolvedValue({ card: { id: "c9" } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Set it up in a thread" }));
    const input = create.mock.calls[0]![0] as { prompt: string; cwd: string; start: boolean };
    expect(input).toMatchObject({ cwd: "/r/shop", start: true, backend: "claude" });
    expect(input.prompt).toContain("STRIPE_SECRET_KEY");
    expect(select).toHaveBeenCalledWith("c9");
    expect(screen.queryByText("📥 Weft took in shop")).not.toBeInTheDocument();
  });

  it("says why when the thread can't start, and stays open", async () => {
    create.mockRejectedValueOnce(new Error("No CLI")).mockRejectedValueOnce("offline");
    show();
    await userEvent.click(screen.getByRole("button", { name: "Set it up in a thread" }));
    expect(screen.getByText("No CLI")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set it up in a thread" }));
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });

  it("offers only Later and 🔐 when values just moved, and Later closes it", async () => {
    show({ imported: 1, importedFrom: [".env.local"], blanks: 0, hooks: 0, tracked: [], details: { imported: [{ name: "A_KEY", file: ".env.local" }], blanks: [], hooks: [] } });
    expect(screen.queryByRole("button", { name: "Set it up in a thread" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open 🪝" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByText("📥 Weft took in shop")).not.toBeInTheDocument();
  });

  it("copes with a result that has no details", () => {
    show({ imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [".env"] });
    expect(screen.queryByRole("button", { name: "Open 🔐" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set it up in a thread" })).toBeInTheDocument();
  });
});

