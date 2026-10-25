// @vitest-environment jsdom
// Share…'s Upload secrets row: what opening or saving the link did with the keys stays shown over the preview's polls,
// which answer without it, and a newer answer replaces it.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./test-utils";
import { UploadSecretsButton } from "./ShareAppDialogUploadSecrets";

const manifest = { public: ["SUPABASE_SECRET_KEY"] } as never;

describe("UploadSecretsButton", () => {
  it("keeps the last answer about the keys when a later state has none", () => {
    const { rerender } = render(<UploadSecretsButton manifest={manifest} appId="app-1" keys={{ pushed: ["SUPABASE_SECRET_KEY"], missing: [] }} />);
    expect(screen.getByText("Uploaded SUPABASE_SECRET_KEY")).toBeTruthy();
    rerender(<UploadSecretsButton manifest={manifest} appId="app-1" />);
    expect(screen.getByText("Uploaded SUPABASE_SECRET_KEY")).toBeTruthy();
    rerender(<UploadSecretsButton manifest={manifest} appId="app-1" keys={{ error: "Touch ID declined." }} />);
    expect(screen.getByText("Touch ID declined.")).toBeTruthy();
  });

  it("says nothing until the keys went somewhere", () => {
    render(<UploadSecretsButton manifest={manifest} appId="app-1" />);
    expect(screen.getByRole("button", { name: "Upload secrets" })).toBeTruthy();
    expect(screen.queryByText(/Uploaded/)).toBeNull();
  });
});
