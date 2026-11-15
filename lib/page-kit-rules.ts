// The rules for a living page in the pane, written out as ~/.weft/show/_kit/README.md by lib/page-kit.ts. One text for
// research pages (plugin/skills/research) and every builder thread's own page (BROWSER_PROMPT): both point here.
export const PAGE_KIT_README = `# Living pages: the pane's page kit

One kit for every page a thread keeps in the pane across turns: research pages and a builder thread's own page. Weft
keeps it in this folder (~/.weft/show/_kit/), so a page links it relative to where it sits:

- ~/.weft/show/<topic>/index.html links ../_kit/research.css in its head and ../_kit/research.js at the end of its body.
- ~/.weft/show/research/<slug>/index.html links ../../_kit/research.css and ../../_kit/research.js.

A builder's page says <body data-unit="Turn">, so the kit labels its sections "Turn 3"; a research page leaves it out
and gets "Round 3".

## The page

- Living blocks near the top hold the current truth, edited in place:
  <section class="living" id="plan" data-title="Plan" data-round="N" data-summary="the block in one line">.
  For research: Answer, Sources, Unknowns. For building: Plan (the steps, the one you're on marked), What changed,
  How to check. Set data-round to the turn that last changed it and keep data-summary current: it's all that shows
  while the block is folded. Make only the blocks the work needs.
- A section per turn, appended at the bottom:
  <section class="round" id="r3" data-round="3" data-when="Sat 23:20" data-asked="what the user asked, short">.
  The kit draws the divider and lights the latest one.

## Keep the pane sane

The user is tired of reading AI output. Each turn, write as if every sentence costs them something:

- Accordions everywhere, closed unless they're the work. The kit opens only the blocks whose data-round is the latest
  turn and the latest turn itself; every other block folds to its title and data-summary, every earlier turn to its
  TL;DR. Detail inside a turn goes in <details><summary>…</summary>…</details>, closed. A bar link or a jump into a fold
  opens it.
- The living blocks are the answer; the turn is the note on what moved. Update the block, then say in the turn what
  changed in one line. Never restate the block in the turn.
- Lead with a TL;DR of one or two sentences (<p class="tldr">). It's what stays visible when the turn folds.
- Budget: a turn's open text is about 150 words unless the user asked for depth.
- No struck-through text. Removed text is simply gone. The turn's Changed box says what moved, in a few words:
  <div class="changed"><a href="#plan">Plan: step 3 done</a></div>.
- Mark sparingly: wrap only new, meaningful text in <mark data-round="N">, three to five per turn. A mark fades to a
  quiet underline once the user has seen it.
- One place to look: end each turn with one mcp__browser__focus on the thing that changed most, with reload: true and a
  short label: the living block if it moved (#plan, label "Plan updated"), otherwise the turn (#r3, label "Turn 3").
  Use mcp__browser__open_url only for the first turn or a different page.
- A chat turn is a small turn: when the user is just talking, a TL;DR line and maybe one block edit is enough.
- End with where to go next: <div class="next"> with two or three specific follow-ups, not generic ones.
`;
