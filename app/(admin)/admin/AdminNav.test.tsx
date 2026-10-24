// @vitest-environment jsdom
// The admin bar's tabs light the current page, including its sub-pages.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/components/test-utils";

const nav = vi.hoisted(() => ({ pathname: "/admin/billing" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { default: AdminNav, isActive } = await import("./AdminNav");

describe("isActive", () => {
  it("matches the tab and its sub-paths, not a lookalike prefix", () => {
    expect(isActive("/admin/users", "/admin/users")).toBe(true);
    expect(isActive("/admin/users/u1", "/admin/users")).toBe(true);
    expect(isActive("/admin/usersx", "/admin/users")).toBe(false);
  });
});

describe("AdminNav", () => {
  it("marks the current page's tab", () => {
    render(<AdminNav />);
    expect(screen.getByText("Billing")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Users")).not.toHaveAttribute("aria-current");
  });
});
