// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-utils";
import { freeTierCapLabel } from "@/lib/billing/plans";
import AccessPlans, { ACCESS_CARDS } from "./AccessPlans";

// components/home/AccessPlans.tsx: the Startups, Open source, Education and Regional pricing row under the plans.

describe("AccessPlans", () => {
  it("reads its numbers from the catalog", () => {
    const [startup, oss, edu, regional] = ACCESS_CARDS;
    expect(startup!.headline).toBe("Team free for six months");
    expect(startup!.body).toContain("Raised under $5M and founded in the last 3 years?");
    expect(startup!.body).toContain("Up to 10 seats of Team");
    expect(startup!.body).toContain("free for six months and half price for six months more");
    for (const c of [oss, edu]) {
      expect(c!.body).toContain(freeTierCapLabel());
      // BlastCP stays off until it applies the tier (docs/architecture/billing.md "BlastCP usage").
      expect(c!.body).not.toContain("BlastCP");
    }
    expect(regional!.headline).toBe("Pro from $5");
    expect(regional!.body).toContain("$5 a month in low-income countries and $10 in lower-middle-income ones");
  });

  it("draws one card per access path, Startups first", () => {
    const { container } = render(<AccessPlans />);
    expect(container.querySelectorAll(".wz-access")).toHaveLength(ACCESS_CARDS.length);
    expect(container.querySelector(".wz-accessHeadline")?.textContent).toBe("Team free for six months");
  });
});
