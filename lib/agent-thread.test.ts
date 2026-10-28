import { describe, expect, it } from "vitest";
import { briefProjectName, briefPrompt, briefTitle, type AgentBrief } from "./agent-thread";
import { briefPage } from "./agent-brief-page";

// The new thread that designs an agent (lib/agent-thread.ts): the brief it runs on and the page
// its pane opens on. What is pinned here is the shape of the brief — the project, the job, and the
// instruction to ask and then write the soul — so a change to it is a deliberate one.

const brief: AgentBrief = { project: "/Users/fotoflo/dev/weft", job: "triages GitHub issues" };

describe("the agent-design brief", () => {
  it("calls the project by its name, not its path", () => {
    expect(briefProjectName("/Users/fotoflo/dev/weft")).toBe("weft");
    expect(briefProjectName("/dev/app")).toBe("app");
  });

  it("titles the thread after the project", () => {
    expect(briefTitle(brief)).toBe("Design an agent for weft");
  });

  it("asks for the agent in the user's words, and says what to do with it", () => {
    const prompt = briefPrompt(brief);
    expect(prompt).toContain("Help me design an agent for weft that triages GitHub issues");
    // It asks the questions itself, and writes the soul with the tool that saves it.
    expect(prompt).toContain("Ask me what you need to know");
    expect(prompt).toContain("one question at a time");
    expect(prompt).toContain("create_agent");
  });

  it("trims the job, so a stray space doesn't reach the thread", () => {
    expect(briefPrompt({ project: "/dev/app", job: "  triages issues  " })).toContain("that triages issues");
  });
});

describe("the brief page", () => {
  it("says what the thread is doing, with the brief on it", () => {
    const html = briefPage(brief);
    expect(html).toContain("Design an agent for weft");
    expect(html).toContain("triages GitHub issues");
    // The project's path, so the user knows which project the agent is for.
    expect(html).toContain("/Users/fotoflo/dev/weft");
  });

  it("escapes what it prints, so a project name can't break the page", () => {
    const html = briefPage({ project: "/dev/<script>app", job: 'says "hi" & <b>' });
    expect(html).not.toContain("<script>app");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;hi&quot;");
    expect(html).toContain("&amp;");
  });
});
