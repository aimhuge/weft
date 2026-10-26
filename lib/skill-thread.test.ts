import { describe, expect, it } from "vitest";
import { skillPageUrl, skillThreadPrompt, skillThreadTitle } from "./skill-thread";

describe("the skill thread", () => {
  const hit = { id: "microsoft/azure-skills/azure-deploy", name: "azure-deploy", source: "microsoft/azure-skills" };

  it("points at the skill's skills.sh page", () => {
    expect(skillPageUrl(hit.id)).toBe("https://www.skills.sh/microsoft/azure-skills/azure-deploy");
  });

  it("is titled after the skill", () => {
    expect(skillThreadTitle(hit)).toBe("✦ Skill: /azure-deploy");
  });

  it("opens the page, scans, reviews, asks, then installs only through skill_install", () => {
    const prompt = skillThreadPrompt(hit);
    expect(prompt).toContain("https://www.skills.sh/microsoft/azure-skills/azure-deploy");
    expect(prompt).toContain('mcp__board__skill_preview with id "microsoft/azure-skills/azure-deploy"');
    expect(prompt).toContain("mcp__board__skill_review");
    expect(prompt).toContain("AskUserQuestion");
    expect(prompt).toContain('mcp__board__skill_install with id "microsoft/azure-skills/azure-deploy"');
    expect(prompt).toMatch(/never copy its files yourself or run `npx skills add`/);
  });
});
