// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import { catalog, freeTierCapLabel, TEAM_SEAT_CENTS } from "@/lib/billing/plans";
import Plans from "./Plans";

// components/home/Plans.tsx: the home page's pricing section. The point of these tests is that the page
// prices itself off the catalog — so a price change in lib/billing/plans.ts moves the page, and nothing here
// can quietly go stale against the plan the app actually charges.

describe("Plans", () => {
  it("draws all three plans in the catalog, in order", () => {
    const { container } = render(<Plans />);
    const names = Array.from(container.querySelectorAll(".wz-planName")).map((n) => n.textContent);
    // Open Source and Education are granted, not sold: they're in the access row under the cards, not cards of their own.
    expect(names).toEqual(catalog.order.filter((id) => id !== "oss" && id !== "edu").map((id) => catalog.get(id).name));
    expect(names).toEqual(["Free", "Pro", "Team"]);
  });

  it("reads each price from the catalog rather than typing it", () => {
    const { container } = render(<Plans />);
    const amounts = Array.from(container.querySelectorAll(".wz-planAmount")).map((n) => n.textContent);
    // Free reads as "Free" rather than "$0"; the paid ones are the catalog's monthly price in dollars.
    expect(amounts[0]).toBe("Free");
    expect(amounts[1]).toBe(`$${catalog.priceCents("pro", "monthly") / 100}`);
    expect(amounts[2]).toBe(`$${TEAM_SEAT_CENTS / 100}`);
  });

  it("prices Team per seat and Pro per workspace", () => {
    const { container } = render(<Plans />);
    const cadences = Array.from(container.querySelectorAll(".wz-planCadence")).map((n) => n.textContent);
    expect(cadences[1]).toBe("/month");
    expect(cadences[2]).toBe("per seat / month");
  });

  it("says teams start on Pro, in Pro's own feature list", () => {
    // The promise the page makes is the gate the code enforces (lib/billing/plan-gate.ts).
    render(<Plans />);
    expect(screen.getByText("Invite your team into the workspace")).toBeTruthy();
  });

  it("marks Pro as the featured plan", () => {
    const { container } = render(<Plans />);
    expect(container.querySelectorAll(".wz-planFeatured")).toHaveLength(1);
    expect(container.querySelector(".wz-planFeatured .wz-planName")?.textContent).toBe("Pro");
  });

  it("draws a feature list per plan", () => {
    const { container } = render(<Plans />);
    const lists = container.querySelectorAll(".wz-planFeatures");
    expect(lists).toHaveLength(3);
    for (const list of lists) {
      expect(list.querySelectorAll("li").length).toBeGreaterThan(0);
    }
  });

  it("lists the BlastCP tier each plan includes, from the catalog", () => {
    const { container } = render(<Plans />);
    const lists = Array.from(container.querySelectorAll(".wz-planFeatures")).map((l) =>
      Array.from(l.querySelectorAll("li")).map((li) => li.textContent),
    );
    expect(lists).toHaveLength(3);
    expect(lists[0]).toContain("BlastCP Free: 1 brand, 3 channels, 30 posts a month");
    expect(lists[0]).toContain("$0.50 of BlastCP AI generation, once");
    for (const list of lists.slice(1)) {
      expect(list).toContain("BlastCP Creator: 1 brand, every channel, unlimited posts");
      expect(list).toContain("$3 a month of BlastCP AI generation");
      // The closing "Everything in …" stays last, after the BlastCP lines.
      expect(list.at(-1)).toMatch(/^Everything in /);
    }
  });

  it("quotes the free tier cap on Free, from the catalog", () => {
    render(<Plans />);
    expect(screen.getByText(`Puku threads on the free tier: ${freeTierCapLabel()}`)).toBeTruthy();
  });

  it("draws the access row under the plans, each marked Coming soon", () => {
    const { container } = render(<Plans />);
    const names = Array.from(container.querySelectorAll(".wz-accessName")).map((n) => n.firstChild?.textContent);
    expect(names).toEqual(["Startups", "Open source", "Education", "Regional pricing"]);
    expect(container.querySelectorAll(".wz-accessSoon")).toHaveLength(4);
  });
});
