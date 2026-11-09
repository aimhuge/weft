// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test-utils";
import { VaultTokenOffer } from "./VaultTokenOffer";

const cand = { folder: "/dev/weft", label: "aimhuge/weft", name: "VERCEL_TOKEN", environment: "development" as const };

describe("VaultTokenOffer", () => {
  it("offers the vault's token by name and hands the pick to onUse", async () => {
    const vaultTokenCandidates = vi.fn(() => Promise.resolve([cand]));
    const onUse = vi.fn(() => Promise.resolve());
    render(<VaultTokenOffer source={{ vaultTokenCandidates }} folders={["/dev/weft"]} busy={false} onUse={onUse} />);
    fireEvent.click(await screen.findByText(/Use VERCEL_TOKEN from aimhuge\/weft/));
    expect(vaultTokenCandidates).toHaveBeenCalledWith(["/dev/weft"]);
    expect(onUse).toHaveBeenCalledWith(cand);
  });

  it("shows nothing without candidates, without the bridge method, or when asking fails", async () => {
    const none = render(<VaultTokenOffer source={{ vaultTokenCandidates: () => Promise.resolve([]) }} folders={[]} busy={false} onUse={vi.fn()} />);
    await waitFor(() => expect(none.container.textContent).toBe(""));
    const old = render(<VaultTokenOffer source={{}} folders={["/a"]} busy={false} onUse={vi.fn()} />);
    expect(old.container.textContent).toBe("");
    const failed = vi.fn(() => Promise.reject(new Error("x")));
    const bad = render(<VaultTokenOffer source={{ vaultTokenCandidates: failed }} folders={["/a"]} busy={false} onUse={vi.fn()} />);
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(bad.container.textContent).toBe("");
    const nullSrc = render(<VaultTokenOffer source={null} folders={["/a"]} busy={false} onUse={vi.fn()} />);
    expect(nullSrc.container.textContent).toBe("");
  });

  it("disables the button while busy", async () => {
    render(<VaultTokenOffer source={{ vaultTokenCandidates: () => Promise.resolve([cand]) }} folders={["/a"]} busy onUse={vi.fn()} />);
    expect(await screen.findByRole<HTMLButtonElement>("button")).toHaveProperty("disabled", true);
  });
});
