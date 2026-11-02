// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSecret } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The recovery menu reads the router; these tests don't mount an app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The 🔐 drawer's search box: narrows the shown vaults to the secrets that match.
const secret = (name: string, environment: VaultSecret["environment"] = "development"): VaultSecret => ({ name, environment, missing: false, tail: "1111", updatedAt: "" });

const overview: VaultOverview = {
  unlocked: false,
  vaults: [
    { id: "github:o/web", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], secrets: [secret("PUKU_API_KEY"), secret("RESEND_API_KEY"), secret("PUKU_API_KEY", "preview")], nudge: null },
    { id: "github:o/api", label: "o/api", folder: "/dev/api", folders: ["/dev/api"], secrets: [secret("DATABASE_URL")], nudge: null },
  ],
};

function setup(project: string | null) {
  const b = { overview: vi.fn(), scan: vi.fn(), import: vi.fn(), reveal: vi.fn(), copy: vi.fn(), set: vi.fn(), addBlank: vi.fn(), copyTo: vi.fn(), remove: vi.fn(), lock: vi.fn() };
  render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={overview} error={null} reload={vi.fn(() => Promise.resolve())} project={project} notify={vi.fn()} />);
}

describe("VaultDrawer search", () => {
  it("lists only the matching secrets, in every environment", async () => {
    setup("/dev/web");
    await userEvent.type(screen.getByLabelText("Filter secrets"), "puku");
    expect(screen.getAllByText("PUKU_API_KEY")).toHaveLength(2);
    expect(screen.queryByText("RESEND_API_KEY")).not.toBeInTheDocument();
  });

  it("drops projects without a match and says when nothing matches", async () => {
    setup(null);
    const box = screen.getByLabelText("Filter secrets");
    await userEvent.type(box, "database");
    expect(screen.getByRole("heading", { name: "o/api" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "o/web" })).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "nope");
    expect(screen.getByText("No secrets match “nope”.")).toBeInTheDocument();
  });

  it("clears on Escape", async () => {
    setup("/dev/web");
    const box = screen.getByLabelText("Filter secrets");
    await userEvent.type(box, "puku");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue("");
    expect(screen.getByText("RESEND_API_KEY")).toBeInTheDocument();
  });
});
