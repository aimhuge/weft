// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamProjectVault } from "@/lib/team-types";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import "../test-utils";
import { ProjectVault } from "./ProjectVault";

const ORG = { id: "o1", slug: "aimhuge", name: "AimHuge", members: 1, admin: true };
const mac = (name: string) => ({ name, person: "Alex", lastSeen: null });
const local = (...names: string[]): TeamProjectVault => ({ shared: null, localOn: names.map(mac) });
const ask = { id: "p1", person: "Sam", deviceName: "m1mini", fingerprint: "ab:cd" };
const shared: TeamProjectVault = { shared: { vaultId: "v1", keyVersion: 1, devices: [{ name: "m5air", person: "Alex", lastSeen: new Date().toISOString() }], asks: [ask] }, localOn: [] };
const here = (over: Partial<VaultSummary> = {}) => ({ id: "github:aimhuge/weft", folder: "/w", label: "aimhuge/weft", secrets: [{ name: "A", missing: false }], ...over }) as unknown as VaultSummary;
const bridge = (over: Partial<VaultBridge> = {}) =>
  ({ share: vi.fn().mockResolvedValue({}), deviceGrant: vi.fn().mockResolvedValue({}), deviceDecline: vi.fn().mockResolvedValue({ declined: true }), ...over }) as unknown as VaultBridge;

function view(props: Partial<Parameters<typeof ProjectVault>[0]> = {}) {
  const onChanged = vi.fn();
  render(<ProjectVault repo="AimHuge/weft" bridge={null} org={ORG} canShare onChanged={onChanged} {...props} />);
  return onChanged;
}

describe("ProjectVault", () => {
  it("shows nothing without a vault anywhere", () => {
    const { container } = render(<ProjectVault repo="a/b" bridge={null} org={ORG} canShare onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("in a browser, names the Mac and links Share secrets to the desktop's drawer", () => {
    view({ vault: local("m5air") });
    expect(screen.getByText("Secrets on m5air only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share secrets" })).toHaveAttribute("href", "weft://secrets?repo=aimhuge%2Fweft&share=1");
  });

  it("on a desktop without the secrets, says which Mac to share from", () => {
    view({ vault: local("m5air"), bridge: bridge() });
    expect(screen.getByText("Share from m5air")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share secrets/ })).not.toBeInTheDocument();
  });

  it("on the Mac with the secrets, shares through the drawer's own dialog", async () => {
    const share = vi.fn().mockResolvedValue({});
    const onChanged = view({ vault: local(), here: here(), bridge: bridge({ share }) });
    expect(screen.getByText("Secrets on this Mac only")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Share secrets/ }));
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Share with AimHuge" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith("/w", "o1", "aimhuge/weft", "aimhuge/weft"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers no share to a member", () => {
    view({ vault: local("m5air"), canShare: false });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens Devices… on a shared vault: who holds the key and the asks, linking Approve from a browser", async () => {
    view({ vault: shared });
    expect(screen.getByText("Secrets shared · 1 device")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Devices…" }));
    expect(screen.getByText(/m5air/)).toBeInTheDocument();
    expect(screen.getByText(/seen just now/)).toBeInTheDocument();
    expect(screen.getByText(/Sam asks to add m1mini/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Approve in Weft" })).toHaveAttribute("href", "weft://secrets?repo=aimhuge%2Fweft");
  });

  it("approves and declines on a Mac holding the key", async () => {
    const grant = vi.fn().mockResolvedValue({});
    const onChanged = view({ vault: shared, here: here({ shared: {} as never }), bridge: bridge({ deviceGrant: grant }) });
    await userEvent.click(screen.getByRole("button", { name: "Devices…" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith("p1"));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText(/Sam asks/)).not.toBeInTheDocument();
  });

  it("declines, and shows a failure", async () => {
    const b = bridge({ deviceDecline: vi.fn().mockRejectedValue(new Error("offline")) });
    view({ vault: shared, here: here({ shared: {} as never }), bridge: b });
    await userEvent.click(screen.getByRole("button", { name: "Devices…" }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("on a desktop without the key, names the Mac to approve on", async () => {
    view({ vault: { ...shared, shared: { ...shared.shared!, devices: [] } }, bridge: bridge() });
    await userEvent.click(screen.getByRole("button", { name: "Devices…" }));
    expect(screen.getByText("No Mac holds the key yet.")).toBeInTheDocument();
    expect(screen.getByText(/Approve it on/)).toBeInTheDocument();
  });
});
