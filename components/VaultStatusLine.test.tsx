// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { VaultStatusLine } from "./VaultStatusLine";

const openSecretsSettings = vi.fn();
vi.mock("@/lib/secrets-settings", () => ({
  openSecretsSettings: (id: string) => {
    openSecretsSettings(id);
  },
}));

afterEach(() => {
  cleanup();
  delete (window as { weft?: unknown }).weft;
  openSecretsSettings.mockReset();
});

const shared = { org: { id: "o1", slug: "acme", name: "Acme" }, vaultId: "v1", keyVersion: 2, serverVersion: 1, recoveryShownAt: null };
const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({ id: "github:o/web", label: "o/web", folder: "/w", folders: ["/w"], secrets: [], nudge: null, shared, ...over });
const withBridge = (bridge: Partial<VaultBridge>) => ((window as { weft?: unknown }).weft = { vault: bridge });

describe("VaultStatusLine", () => {
  it("pushes this Mac's values in place and says what went up", async () => {
    const pushLocal = vi.fn(() => Promise.resolve({ pushed: [{ name: "GA4_PROPERTY_ID", environment: "production" as const }], kept: [], queued: 0 }));
    withBridge({ pushLocal });
    const notify = vi.fn();
    render(<VaultStatusLine vault={vault({ localOnly: 1 })} notify={notify} />);
    expect(screen.getByText("Shared with Acme · 1 only on this Mac")).toBeTruthy();
    fireEvent.click(screen.getByText("Push"));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(pushLocal).toHaveBeenCalledWith("/w");
    expect((notify.mock.calls[0] as unknown as [Error])[0].message).toBe("Shared with your team: GA4_PROPERTY_ID.");
    expect(openSecretsSettings).not.toHaveBeenCalled();
  });

  it("shows a failed or refused Push quietly or as a toast", async () => {
    const notify = vi.fn();
    withBridge({ pushLocal: vi.fn(() => Promise.reject(new Error("offline"))) });
    render(<VaultStatusLine vault={vault({ localOnly: 2 })} notify={notify} />);
    fireEvent.click(screen.getByText("Push"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("offline")));
    cleanup();
    withBridge({ pushLocal: vi.fn(() => Promise.resolve({ denied: true as const })) });
    render(<VaultStatusLine vault={vault({ localOnly: 2 })} notify={notify} />);
    fireEvent.click(screen.getByText("Push"));
    await waitFor(() => expect(screen.getByText("Push")).toBeTruthy());
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("opens Settings → Secrets otherwise, and in a shell with no Push", () => {
    render(<VaultStatusLine vault={vault({ localOnly: 1 })} />);
    expect(screen.queryByText("Push")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(openSecretsSettings).toHaveBeenCalledWith("github:o/web");
  });

  it("shows nothing when there's nothing to say", () => {
    const { container } = render(<VaultStatusLine vault={vault({ shared: undefined, id: "folder:/w" })} />);
    expect(container.innerHTML).toBe("");
  });
});
