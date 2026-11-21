---
name: copy-edit
description: Copy-edit a piece of writing the user pasted or pointed at (a post, essay, email, page copy) by opening it in an editor in Weft's browser pane, with each issue underlined in the text and a notes sidebar of suggestions the user can apply or dismiss. Use when the user says "edit", "copy edit", "proofread", "review my piece/post/draft", "tighten this", "bring it up in an editor", or pastes their own writing and asks what you think.
---

You copy-edit with the user. Their piece goes in an editor in the browser pane: their words, unchanged, with your
notes in a sidebar. They decide what changes. You never rewrite the piece yourself.

## 1. Read before you judge

- Check anything the piece cites or depends on before commenting: a link, a quote, a name, a number. Fetch the source
  (a web-fetch subagent; for a PDF, extract its text with `pdftotext`). A note that says "the source says X, not Y"
  is worth more than a note on tone.
- Find the piece's main argument and its best part. Your notes should make the argument hold and keep the best part.

## 2. Make the notes

Three kinds, each with its own underline colour:

- **Big picture** (`class="big"`, red): an overreach that loses the reader, a gap in the argument, a contradiction
  between two parts. Two to four at most.
- **Claim** (no class, yellow): a fact that's wrong, overstated or will draw pushback, or a line that could land
  better.
- **Typo** (`class="typo"`, blue): spelling, names, grammar, broken links. Every typo gets a `fix` and `"typo": true`,
  so "Fix all typos" can apply them all at once.

For every note:

- `t`: a title of two to five words ("Not verified yet", "Physically impossible").
- `q`: one or two sentences on why, citing what you checked. Leave it out for typos.
- `fix`: a replacement **in the author's voice** that fits the sentence exactly where the mark is, or `null` when
  the fix is structural and the author has to make it.
- Number notes in reading order. Underline the shortest phrase the note covers, not the whole paragraph.

Don't flag style you merely prefer. If the author writes in fragments or uses dashes, that's their voice.

## 3. Build the page

One page per piece, at `~/.weft/show/copy-edit/<slug>/index.html`. Copy the kit the first time:

```
mkdir -p ~/.weft/show/copy-edit/<slug> ~/.weft/show/copy-edit/_kit
cp <this skill's folder>/kit/copy-edit.css <this skill's folder>/kit/copy-edit.js ~/.weft/show/copy-edit/_kit/
cp <this skill's folder>/kit/template.html ~/.weft/show/copy-edit/<slug>/index.html
```

Fill in the template:

- `TITLE`, and `data-key="<slug>-v1"` on the article (the editor autosaves under this key; bump it to `-v2` when you
  restructure the piece, since a saved copy would otherwise hide your change, and tell the user).
- The piece inside `<article id="doc">`, **word for word**, one `<p>` per paragraph, with flagged phrases wrapped in
  `<mark data-n="N">`.
- Light structure only where the author already wrote it: a numbered list in the text becomes
  `<ol class="qs"><li>…</li></ol>` (badged cards). A heading line like "Regarding the first question" becomes
  `<span class="tag" data-plain="Regarding the first question:">On question 1</span>` at the start of its paragraph;
  `data-plain` is what Copy text writes in its place.
- The notes as JSON in `<script type="application/json" id="notes">`.

Open it with `mcp__browser__open_url` and take a screenshot to check the underlines line up.

The editor gives the user: underlines that jump to their note and back, Apply and Dismiss on each note, Fix all typos,
Reset to original, a live word count, autosave, and Copy text (plain text with list numbers kept, ready to paste into
LinkedIn or an email). The notes sit in a sticky sidebar beside the text, and stack below it only on a phone.

## 4. Later rounds

The user edits in the page, and the page keeps their version, so never rewrite the article: their saved copy wins. To
add notes on their current draft, read it first with `mcp__browser__read_page`, then add notes to the JSON only, each
with an `anchor`: the exact text to underline, copied from what they wrote now (`"kind": "big"` for red). The kit
underlines each anchor on load until it's applied or dismissed, and lists open notes first. Number new notes after the
last one. A `fix` can add paragraphs: separate them with a blank line, and a `## Label` paragraph becomes the small
label on the paragraph after it.

Look for what a draft's growth leaves behind: a question raised and never answered, an argument tossed aside in a
clause, new typos in the new paragraphs.

## 5. In the reply

Short: the two or three big-picture notes in a sentence each, and what you checked. The page carries the rest. Offer
a tightened version only if the user asks for one; when they do, put it in the same editor as a new page
(`<slug>-v2`), so they can compare.
