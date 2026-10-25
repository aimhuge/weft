import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { installSkill, previewSkill, SkillInstallError } from "./skill-install";
import { SKILL_ID } from "./skill-registry";
import { remoteTarget, startReview } from "./skill-review";
import { skillPageUrl } from "./skill-thread";
import type { RemoteSkillPreview, SkillReviewState } from "./types";

// mcp__board__skill_preview / _review / _install, in every thread's board tools (lib/board-tools.ts): the thread a
// skills.sh hit opens (lib/skill-thread.ts) looks a skill over and installs it through Weft's own copy, the one
// it scanned (lib/skill-install.ts), never by copying files or `npx skills add`.

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (text: string, isError = false): Reply => ({ content: [{ type: "text" as const, text }], ...(isError ? { isError } : {}) });

async function attempt(run: () => Promise<string>): Promise<Reply> {
  try {
    return reply(await run());
  } catch (err) {
    return reply(err instanceof Error ? err.message : String(err), true);
  }
}

const ID = z.string().regex(SKILL_ID).describe("The skill's skills.sh id, owner/repo/skill");

export function reviewLines(state: SkillReviewState): string[] {
  if (state.status === "none") return ["AI review: not started (call skill_review)."];
  const page = `Review page (open it in the pane): file://${encodeURI(state.page)}`;
  if (state.status === "running") return ["AI review: running, about 20 seconds; call skill_review again to read it.", page];
  if (state.status === "failed") return [`AI review: failed (${state.error}); call skill_review to try again.`, page];
  const { review } = state;
  return [
    `AI review: ${review.verdict}. ${review.summary}`,
    ...review.concerns.map((c) => `- ${c.severity}: ${c.explanation}${c.file ? ` (${c.file}${c.line ? `:${c.line}` : ""})` : ""}`),
    `Recommendation: ${review.recommendation}`,
    page,
  ];
}

export function previewText(p: RemoteSkillPreview): string {
  const { scan } = p;
  const findings = scan.findings.slice(0, 20).map((f) => `- ${f.severity} [${f.rule}] ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}${f.excerpt ? `: ${f.excerpt}` : ""}`);
  return [
    `/${p.name} from ${p.source}${p.installed ? " (already installed)" : ""}${p.offline ? " (skills.sh unreachable: Weft's kept copy)" : ""}`,
    `Page: ${skillPageUrl(p.id)}`,
    p.description && `Description: ${p.description}`,
    `${p.files.length} files, hash ${p.hash.slice(0, 12)}`,
    `Static scan: ${scan.verdict}. License: ${scan.license.spdx ?? scan.license.kind}${scan.license.file ? ` (${scan.license.file})` : ""}. Hosts its scripts call: ${scan.hosts.join(", ") || "none"}.`,
    findings.length ? `Findings:\n${findings.join("\n")}` : "Findings: none.",
    ...reviewLines(p.review),
  ]
    .filter(Boolean)
    .join("\n");
}

export function skillTools(getCwd: () => string) {
  return [
    tool("skill_preview", "Fetch a skills.sh skill into Weft's copy and read Weft's static scan of it (code, prompt injection, telemetry, license) and any AI review.", { id: ID }, ({ id }) =>
      attempt(async () => previewText(await previewSkill(id, getCwd()))),
    ),
    tool("skill_review", "Start (or read) the AI review of a skills.sh skill Weft has previewed. Gives the review page to open in the browser pane.", { id: ID }, ({ id }) =>
      attempt(() => {
        const target = remoteTarget(id);
        if (!target) throw new Error("Weft has no copy of that skill yet: call skill_preview first.");
        return Promise.resolve(reviewLines(startReview(target)).join("\n"));
      }),
    ),
    tool(
      "skill_install",
      "Install a skills.sh skill into ~/.claude/skills from the copy Weft scanned. Only after the user said to install it.",
      { id: ID, force: z.boolean().optional().describe("Install even though the scan or review says it's dangerous; only when the user chose that") },
      ({ id, force }) =>
        attempt(async () => {
          try {
            const { name, dir } = await installSkill(id, { force: force === true });
            return `Installed /${name} in ${dir}. A thread started from now on gets it.`;
          } catch (err) {
            if (err instanceof SkillInstallError && err.scan) throw new Error(`${err.message} Nothing was installed.`);
            throw err;
          }
        }),
    ),
  ];
}
