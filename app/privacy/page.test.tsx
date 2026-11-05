// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/components/test-utils";
import { allReserved } from "@/lib/app-routes";
import PrivacyPage from "./page";

describe("the privacy policy", () => {
  it("names every processor the deployed Weft sends data to", () => {
    const { container } = render(<PrivacyPage />);
    for (const name of ["Vercel", "Supabase", "GitHub", "Google Analytics", "PostHog", "Stripe", "Slack", "Resend", "Anthropic", "Puku"]) {
      expect(container.querySelector("ul")?.parentElement?.textContent).toContain(name);
    }
  });

  it("says analytics wait for consent, with the switch under #cookies", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.querySelector("#cookies")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Turn them on" })).toBeInTheDocument();
    expect(container.textContent).toMatch(/session replay/i);
    expect(container.textContent).toContain("Settings → Security");
  });

  it("links the Terms and gives the legal contact", () => {
    render(<PrivacyPage />);
    expect(screen.getAllByRole("link", { name: /Terms/ })[0]).toHaveAttribute("href", "/terms");
    expect(screen.getAllByRole("link", { name: "legal@weft.zip" })[0]).toHaveAttribute("href", "mailto:legal@weft.zip");
  });

  it("states Google's Limited Use terms under #google, which Google's OAuth review reads", () => {
    const { container } = render(<PrivacyPage />);
    const google = container.querySelector("#google")?.parentElement?.textContent ?? "";
    expect(container.querySelector("#google")).not.toBeNull();
    expect(google).toContain("Limited Use");
    expect(google).toMatch(/train AI or machine-learning models/);
    expect(screen.getByRole("link", { name: "Google API Services User Data Policy" })).toHaveAttribute(
      "href",
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
  });

  it("is a reserved first segment, so no workspace or app link can take /privacy", () => {
    expect(allReserved()).toContain("privacy");
  });
});
