import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSkillPreview, SkillReview, SkillScan } from "./types";

// The thread a skills.sh hit opens looks the skill over and installs it through these (lib/skill-tools.ts).

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _d: string, _s: unknown, handler: CapturedTool["handler"]) => ({ name, handler }),
}));

const install = vi.hoisted(() => ({ previewSkill: vi.fn(), installSkill: vi.fn() }));
vi.mock("./skill-install", async () => ({ ...(await vi.importActual<typeof import("./skill-install")>("./skill-install")), ...install }));
const review = vi.hoisted(() => ({ remoteTarget: vi.fn(), startReview: vi.fn() }));
vi.mock("./skill-review", () => review);

const { SkillInstallError } = await import("./skill-install");
const { previewText, reviewLines, skillTools } = await import("./skill-tools");
const { isTrustedTool } = await import("./board-tools-trust");

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({ verdict: "clean", findings: [], license: { spdx: "MIT", kind: "permissive", file: "LICENSE" }, hosts: [], files: 2, bytes: 100, ...over });
const preview = (over: Partial<RemoteSkillPreview> = {}): RemoteSkillPreview => ({
  id: "acme/skills/pdf",
  source: "acme/skills",
  name: "pdf",
  description: "Read PDFs",
  hash: "abcdef0123456789".repeat(4),
  files: [{ path: "SKILL.md", bytes: 10 }],
  scan: scan(),
  review: { status: "none" },
  installed: false,
  ...over,
});
const done: SkillReview = {
  verdict: "caution",
  summary: "Deploys to Azure.",
  whatItDoes: "",
  concerns: [
    { severity: "medium", file: "run.sh", line: 4, explanation: "Broad SQL grants." },
    { severity: "low", explanation: "Billable." },
    { severity: "low", file: "a.md", explanation: "No line." },
  ],
  falsePositives: [],
  dataFlow: "",
  license: "",
  recommendation: "Check the subscription.",
  model: "sonnet",
  reviewedAt: "2026-10-26T00:00:00Z",
};

const tools = skillTools(() => "/dev/app") as unknown as CapturedTool[];
const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args);

beforeEach(() => vi.clearAllMocks());

describe("reviewLines", () => {
  it("says what to do at each stage, and gives the page to open", () => {
    expect(reviewLines({ status: "none" })).toEqual(["AI review: not started (call skill_review)."]);
    expect(reviewLines({ status: "running", page: "/tmp/my review.html" })[1]).toBe("Review page (open it in the pane): file:///tmp/my%20review.html");
    expect(reviewLines({ status: "failed", page: "/tmp/r.html", error: "boom" })[0]).toBe("AI review: failed (boom); call skill_review to try again.");
    const lines = reviewLines({ status: "done", page: "/tmp/r.html", review: done });
    expect(lines).toContain("AI review: caution. Deploys to Azure.");
    expect(lines).toContain("- medium: Broad SQL grants. (run.sh:4)");
    expect(lines).toContain("- low: Billable.");
    expect(lines).toContain("- low: No line. (a.md)");
    expect(lines).toContain("Recommendation: Check the subscription.");
  });
});

describe("previewText", () => {
  it("lists the page, scan, license, hosts and findings", () => {
    const text = previewText(
      preview({
        scan: scan({
          verdict: "danger",
          hosts: ["api.acme.io", "cdn.acme.io"],
          findings: [
            { severity: "danger", category: "code", rule: "pipe-to-shell", message: "Pipes a script into a shell", file: "SKILL.md", line: 8, excerpt: "curl x | bash" },
            { severity: "warn", category: "license", rule: "license-none", message: "No license", file: "README.md" },
            { severity: "info", category: "telemetry", rule: "hosts", message: "Calls 2 hosts" },
          ],
        }),
      }),
    );
    expect(text).toContain("/pdf from acme/skills\nPage: https://www.skills.sh/acme/skills/pdf\nDescription: Read PDFs");
    expect(text).toContain("Static scan: danger. License: MIT (LICENSE). Hosts its scripts call: api.acme.io, cdn.acme.io.");
    expect(text).toContain("- danger [pipe-to-shell] Pipes a script into a shell (SKILL.md:8): curl x | bash");
    expect(text).toContain("- warn [license-none] No license (README.md)");
    expect(text).toContain("- info [hosts] Calls 2 hosts\n");
  });

  it("says when it's installed, offline, unlicensed and clean", () => {
    const text = previewText(preview({ installed: true, offline: true, description: "", scan: scan({ license: { spdx: null, kind: "none" } }) }));
    expect(text).toContain("(already installed) (skills.sh unreachable: Weft's kept copy)");
    expect(text).not.toContain("Description:");
    expect(text).toContain("License: none. Hosts its scripts call: none.");
    expect(text).toContain("Findings: none.");
  });
});

describe("skillTools", () => {
  it("previews in the thread's folder", async () => {
    install.previewSkill.mockResolvedValue(preview());
    const res = await run("skill_preview", { id: "acme/skills/pdf" });
    expect(install.previewSkill).toHaveBeenCalledWith("acme/skills/pdf", "/dev/app");
    expect(res.content[0]?.text).toContain("/pdf from acme/skills");
  });

  it("reports a preview that fails as an error", async () => {
    install.previewSkill.mockRejectedValue(new Error("skills.sh answered 404."));
    expect(await run("skill_preview", { id: "acme/skills/pdf" })).toEqual({ content: [{ type: "text", text: "skills.sh answered 404." }], isError: true });
    install.previewSkill.mockRejectedValue("plain");
    expect((await run("skill_preview", { id: "acme/skills/pdf" })).content[0]?.text).toBe("plain");
  });

  it("starts a review of the kept copy, or says to preview first", async () => {
    review.remoteTarget.mockReturnValueOnce(undefined);
    const missing = await run("skill_review", { id: "acme/skills/pdf" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toMatch(/call skill_preview first/);
    review.remoteTarget.mockReturnValueOnce({ key: "k" });
    review.startReview.mockReturnValueOnce({ status: "running", page: "/tmp/r.html" });
    const started = await run("skill_review", { id: "acme/skills/pdf" });
    expect(review.startReview).toHaveBeenCalledWith({ key: "k" });
    expect(started.content[0]?.text).toMatch(/^AI review: running/);
  });

  it("installs, passing force only when it's true", async () => {
    install.installSkill.mockResolvedValue({ name: "pdf", dir: "/home/.claude/skills/pdf", scan: scan() });
    const res = await run("skill_install", { id: "acme/skills/pdf" });
    expect(install.installSkill).toHaveBeenLastCalledWith("acme/skills/pdf", { force: false });
    expect(res.content[0]?.text).toBe("Installed /pdf in /home/.claude/skills/pdf. A thread started from now on gets it.");
    await run("skill_install", { id: "acme/skills/pdf", force: true });
    expect(install.installSkill).toHaveBeenLastCalledWith("acme/skills/pdf", { force: true });
  });

  it("says nothing was installed when the scan stops it, and passes other errors through", async () => {
    install.installSkill.mockRejectedValueOnce(new SkillInstallError("Weft's scan found something dangerous in this skill.", 409, scan({ verdict: "danger" })));
    const refused = await run("skill_install", { id: "acme/skills/pdf" });
    expect(refused).toEqual({ content: [{ type: "text", text: "Weft's scan found something dangerous in this skill. Nothing was installed." }], isError: true });
    install.installSkill.mockRejectedValueOnce(new SkillInstallError("No scan.", 409));
    expect((await run("skill_install", { id: "acme/skills/pdf" })).content[0]?.text).toBe("No scan.");
    install.installSkill.mockRejectedValueOnce(new Error("EACCES"));
    expect((await run("skill_install", { id: "acme/skills/pdf" })).content[0]?.text).toBe("EACCES");
  });

  it("lets preview and review run without asking, but not install", () => {
    expect(isTrustedTool("mcp__board__skill_preview", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__skill_review", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__skill_install", "sdk")).toBe(false);
  });
});
