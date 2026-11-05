// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { repoOf, shareTargets, type VaultOrg } from "@/lib/vault-shared";
import "./test-utils";
import { ShareOffer, SharedBadge } from "./VaultParts";

// The shared vault's pieces of the 🔐 drawer (docs/architecture/teams-vault.md, "What the 🔐 drawer
// shows"): the badge on a shared vault's header and the offer to share a local one with a workspace.

const shared = {
  org: { id: "o1", slug: "acme", name: "Acme" },
  vaultId: "v1",
  keyVersion: 3,
  serverVersion: 42,
  recoveryShownAt: null,
};

const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  id: "github:o/web",
  label: "o/web",
  folder: "/dev/web",
  folders: ["/dev/web"],
  secrets: [],
  nudge: null,
  ...over,
});

const org = (over: Partial<VaultOrg> = {}): VaultOrg => ({ id: "o1", slug: "acme", name: "Acme", members: 2, ...over });

function bridge(over: Partial<VaultBridge> = {}): VaultBridge {
  return {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(),
    copyTo: vi.fn(),
    remove: vi.fn(),
    lock: vi.fn(),
    share: vi.fn(() => Promise.resolve({ vaultId: "v1", repo: "o/web", keyVersion: 1, orgId: "o1" })),
    ...over,
  };
}

describe("SharedBadge", () => {
  it("shows the workspace's name and the vault key's version", () => {
    render(<SharedBadge vault={vault({ shared })} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("says the key version in its tooltip", () => {
    render(<SharedBadge vault={vault({ shared })} />);
    expect(screen.getByTitle("vault key version 3")).toBeInTheDocument();
  });

  it("shows nothing for a local vault", () => {
    const { container } = render(<SharedBadge vault={vault()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("carries no key material or ciphertext", () => {
    const { container } = render(<SharedBadge vault={vault({ shared })} />);
    const text = container.textContent;
    expect(text).not.toMatch(/wrapped|cipher/i);
    expect(Object.keys(shared)).toEqual(["org", "vaultId", "keyVersion", "serverVersion", "recoveryShownAt"]);
  });
});

describe("ShareOffer", () => {
  const open = () => userEvent.click(screen.getByRole("button", { name: /Share…/ }));
  const confirm = async () => {
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Share with Acme" }));
  };

  it("offers Share… in the header, with no dialog until it's clicked", () => {
    render(<ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={bridge()} label="o/web" repo="o/web" onShared={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Share…/ })).toHaveAttribute("title", "Share this vault with Acme");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains what sharing hands over and waits for the user to say they understand", async () => {
    const share = vi.fn(() => Promise.resolve({ vaultId: "v1", repo: "o/web", keyVersion: 1, orgId: "o1" }));
    render(<ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={bridge({ share })} label="o/web" repo="o/web" secrets={3} onShared={vi.fn()} notify={vi.fn()} />);
    await open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("3 secrets in o/web");
    expect(dialog).toHaveTextContent(/can't be taken back/);
    expect(dialog).toHaveTextContent(/end-to-end encrypted/);
    const go = screen.getByRole("button", { name: "Share with Acme" });
    expect(go).toBeDisabled();
    await userEvent.click(go);
    expect(share).not.toHaveBeenCalled();
  });

  it("closes on Cancel without sharing", async () => {
    const share = vi.fn();
    render(<ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={bridge({ share })} label="o/web" repo="o/web" onShared={vi.fn()} notify={vi.fn()} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it("is hidden when there is no workspace to share with", () => {
    const { container } = render(
      <ShareOffer folder="/dev/web" org={null} orgs={[org({ members: 1 })]} bridge={bridge()} label="o/web" repo="o/web" onShared={vi.fn()} notify={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden when the shell can't share", () => {
    const { container } = render(
      <ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={bridge({ share: undefined })} label="o/web" repo="o/web" onShared={vi.fn()} notify={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shares the vault with the chosen workspace, closes and reloads", async () => {
    const share = vi.fn(() => Promise.resolve({ vaultId: "v1", repo: "o/web", keyVersion: 1, orgId: "o1" }));
    const onShared = vi.fn();
    render(<ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={bridge({ share })} label="o/web" repo="o/web" onShared={onShared} notify={vi.fn()} />);
    await open();
    await confirm();
    await waitFor(() => expect(share).toHaveBeenCalledWith("/dev/web", "o1", "o/web", "o/web"));
    await waitFor(() => expect(onShared).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a picker in the dialog when the user is in more than one workspace", async () => {
    render(
      <ShareOffer
        folder="/dev/web"
        org={org()}
        orgs={[org(), org({ id: "o2", slug: "beta", name: "Beta" })]}
        bridge={bridge()}
        label="o/web"
        repo="o/web"
        onShared={vi.fn()}
        notify={vi.fn()}
      />,
    );
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Workspace to share with"), "o2");
    expect(screen.getByRole("button", { name: "Share with Beta" })).toBeInTheDocument();
  });

  it("says the error as a toast and doesn't reload", async () => {
    const b = bridge({ share: vi.fn(() => Promise.reject(new Error("Couldn't share this vault."))) });
    const notify = vi.fn();
    const onShared = vi.fn();
    render(<ShareOffer folder="/dev/web" org={org()} orgs={[org()]} bridge={b} label="o/web" repo="o/web" onShared={onShared} notify={notify} />);
    await open();
    await confirm();
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(onShared).not.toHaveBeenCalled();
  });
});

describe("shareTargets", () => {
  it("keeps a workspace of one: sharing there reaches the user's own other Macs", () => {
    expect(shareTargets([org({ members: 1 })])).toHaveLength(1);
    expect(shareTargets([org({ members: 0 }), org({ id: "o2", admin: false })])).toEqual([]);
  });

  it("puts the workspace named like the repo's owner first", () => {
    const exiting = org({ id: "ex", slug: "exiting", name: "Exiting.com", members: 3 });
    const aimhuge = org({ id: "ah", slug: "aimhuge-x1", name: "AimHuge", members: 1 });
    expect(shareTargets([exiting, aimhuge], "aimhuge/weft").map((o) => o.id)).toEqual(["ah", "ex"]);
    expect(shareTargets([exiting, org({ id: "s", slug: "fotoflo", name: "Mine" })], "fotoflo/app")[0]!.id).toBe("s");
    expect(shareTargets([exiting, aimhuge]).map((o) => o.id)).toEqual(["ex", "ah"]);
  });
});

describe("repoOf", () => {
  it("reads the GitHub repo out of the vault's id", () => {
    expect(repoOf("github:o/web")).toBe("o/web");
  });

  it("has no repo for a folder-only vault", () => {
    expect(repoOf("folder:/dev/notes")).toBe("");
  });
});
