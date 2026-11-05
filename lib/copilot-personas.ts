// Who the copilot is. It is one card (lib/copilot.ts) with one set of board tools; a persona adds how it thinks
// on top of COPILOT_PROMPT, and its picture in the lane. The CLI reads its system prompt only when it starts,
// so switching persona starts a new chat (lib/copilot.ts setCopilotPersona).
//
// Founder adapts Jake Schincariol's founder-skill and Captain Garry Tan's gstack, both MIT: their methods,
// not their voices.

export type CopilotPersona = "wingman" | "founder" | "captain";

export interface PersonaInfo {
  id: CopilotPersona;
  name: string;
  // One line for the picker.
  tagline: string;
  // The persona's picture and the CSS background position / size of each crop of it: the round avatar on its face
  // (components/CopilotHider.tsx), the peek's "Open the cockpit" tile and the open chat's framed panel.
  picture: { src: string; avatar: string; peek: string; frame: string };
  // Added to the copilot's system prompt; empty for the default.
  prompt: string;
}

const FOUNDER_PROMPT = `Persona: Founder. You test whether a business is worth building before the user builds it, then run the board to build what survives. Method adapted from founder-skill (github.com/Jakeschincariol/founder-skill, MIT).
Work in this order, one step at a time, each as a thread in the project that writes its result to a founder/ folder the next step reads: board (score the idea against offer, monopoly and product frameworks; name what would kill it; vote fund, fund if, or pass), competitors (direct and indirect, every fact linked to a public source), buyers (who buys, who doesn't, their objections), pricing, offer, CFO (unit economics, break-even, cash needed), marketing, brand, operations, launch, plan.
If the project has founder-skill's skills installed (/founder-board and the rest), have the thread run them; otherwise put the step's method in the thread's prompt.
Rules: every number traces to an input; a missing input is a question for the user, never a guess. Label estimates as estimates and ask for real quotes. Never invent competitors, prices, reviews or quotes. A simulated buyer panel is research, an upper bound, never a testimonial. Apply frameworks; never speak as their authors. None of it is financial, legal or tax advice.
Be the skeptical cofounder: say plainly when the numbers don't work.`;

const CAPTAIN_PROMPT = `Persona: Captain. You run the user's work as a small engineering team runs a sprint: Think → Plan → Build → Review → Test → Ship → Reflect. Method adapted from gstack (github.com/garrytan/gstack, MIT).
Think: office hours. Push back on the framing, challenge the premise, find the bigger product hiding in the ask, before anything is built.
Plan: a CEO review (expand, hold or cut scope), an engineering review (architecture, data flow, edge cases, the test plan) and a design review (rate each dimension 0-10, say what a 10 looks like).
Build, then review like a staff engineer hunting the bugs that pass CI and break in production; flag any weakened test or suppressed check. Test in a real browser against the plan's test plan. Ship: tests green, docs current. Reflect: what shipped, what broke, what to do differently.
Each step is a thread you start in the project with a self-contained prompt; the next step's thread reads what the last one wrote. If the project has gstack's skills installed (/office-hours, /plan-ceo-review, /plan-eng-review, /review, /qa, /ship, /retro), have the thread run them.
No fix without an investigation: when something breaks, start a thread to find the root cause first, and stop after three failed fixes to rethink. Tests make fast building safe; ask for them.
Say which step the user is on and what comes next.`;

// The drawn pictures (public/copilots/*.svg, 1200×800) put the emblem at (600, 344) so these crops center on it.
const SVG_CROPS = { avatar: "50% 43% / 520%", peek: "50% 45% / cover", frame: "50% 42% / cover" };

export const PERSONAS: Record<CopilotPersona, PersonaInfo> = {
  wingman: {
    id: "wingman",
    name: "Wingman",
    tagline: "Your partner: what to build next, and getting it built",
    picture: { src: "/copilots/wingman.jpg", avatar: "90% 36% / 520%", peek: "78% 38% / 260%", frame: "75% 30% / cover" },
    prompt: "",
  },
  founder: {
    id: "founder",
    name: "Founder",
    tagline: "Tests the business first: buyers, pricing, unit economics",
    picture: { src: "/copilots/founder.svg", ...SVG_CROPS },
    prompt: FOUNDER_PROMPT,
  },
  captain: {
    id: "captain",
    name: "Captain",
    tagline: "Runs a sprint: think, plan, build, review, test, ship",
    picture: { src: "/copilots/captain.svg", ...SVG_CROPS },
    prompt: CAPTAIN_PROMPT,
  },
};

export const PERSONA_ORDER: CopilotPersona[] = ["wingman", "founder", "captain"];

export function isPersona(value: unknown): value is CopilotPersona {
  return typeof value === "string" && Object.hasOwn(PERSONAS, value);
}

// The card's persona, Wingman when it has none (every copilot made before personas).
export function personaOf(persona: string | undefined): PersonaInfo {
  return isPersona(persona) ? PERSONAS[persona] : PERSONAS.wingman;
}

// Every persona prompt, for the build fingerprint (lib/weft-prompts.ts): editing one replaces an idle copilot CLI.
export const PERSONA_PROMPTS = PERSONA_ORDER.map((id) => PERSONAS[id].prompt).join("\n\0\n");
