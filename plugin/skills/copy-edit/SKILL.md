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
- `q`: the write-up the user reads in the sidebar. Short for a small claim (one or two sentences on why, citing
  what you checked). For a big-picture or structural note, write it out in paragraphs separated by a blank line:
  what's wrong (quote their words), what the fix changes (for a move, the section's order before and after, numbered),
  and why it matters to the reader. Plain words, no jargon. Leave it out for typos.
- `fix`: a replacement **in the author's voice** that fits the sentence exactly where the mark is, or `null` when
  the fix is structural and the author has to make it.
- Number notes in reading order. Underline the shortest phrase the note covers, not the whole paragraph.

Don't flag style you merely prefer. If the author writes in fragments or uses dashes, that's their voice.

## 3. Build the page

One page per piece, at `~/.weft/show/copy-edit/<slug>/index.html`. Copy the kit the first time:

```
mkdir -p ~/.weft/show/copy-edit/<slug> ~/.weft/show/copy-edit/_kit
cp <this skill's folder>/kit/copy-edit*.css <this skill's folder>/kit/copy-edit*.js ~/.weft/show/copy-edit/_kit/
cp <this skill's folder>/kit/template.html ~/.weft/show/copy-edit/<slug>/index.html
```

Fill in the template:

- `TITLE`, and `data-key="<slug>-v1"` on the article (the editor autosaves under this key; bump it to `-v2` when you
  restructure the piece, since a saved copy would otherwise hide your change, and tell the user).
- The piece inside `<article id="doc">`, **word for word**, one `<p>` per paragraph, with flagged phrases wrapped in
  `<mark data-n="N">`.
- Light structure only where the author already wrote it: a numbered list in the text becomes
  `<ol class="qs"><li>…</li></ol>` (badged cards). A heading line like "Regarding the first question" becomes
  `<span class="tag">Regarding the first question</span>` at the start of its paragraph, in the author's words;
  Copy text writes it as its own line, as written.
- Headings the author wrote as headings stay `<h1>` / `<h2>`, and links stay `<a href>`: Export writes them as `#`, `##`
  and `[text](url)`, Copy text as `text (url)`. The toolbar's Text / H1 / H2 menu changes the block the caret is in.
- The notes as JSON in `<script type="application/json" id="notes">`.

Open it with `mcp__browser__open_url` and take a screenshot to check the underlines line up.

The editor gives the user: underlines that jump to their note and back, Apply and Dismiss on each note, Reopen on a
resolved note whose words are still in the draft (an accidental Dismiss), Fix all typos,
Reset to original, a live word count, autosave, Export (piece.md and every image in one .zip), and Copy text (plain text with list numbers kept, ready to paste into
LinkedIn or an email). The notes sit in a sticky sidebar beside the text, and stack below it only on a phone.

## 4. Later rounds

The user edits in the page, and the page keeps their version, so never rewrite the article: their saved copy wins. To
add notes on their current draft, read it first with `mcp__browser__read_page`, then add notes to the JSON only, each
with an `anchor`: the exact text to underline, copied from what they wrote now (`"kind": "big"` for red). The kit
underlines each anchor on load until it's applied or dismissed, and lists open notes first. Number new notes after the
last one. A `fix` can add paragraphs: separate them with a blank line, and a `## Label` paragraph becomes the small
label on the paragraph after it.

When the user asks you to make a change yourself, do it through notes and click Apply in the pane, so it lands in
their saved copy. A move is two notes: one whose `fix` is `" "` removes the text, and one that inserts it before the
target's opening words. Copy each anchor from `read_page` right before (they may have just fixed a typo inside it),
check both are underlined (`mcp__browser__wait_for` on `mark[data-n="N"]`), then apply the removal before the insert.
A link goes in as plain text in brackets, `(https://…)`, so it survives Copy text.

Images: the user adds one with Add image, by pasting, or by dropping a file on the text; it lands after the
paragraph they're in, as a figure with an editable caption (hover for ↑ ↓ to move it a paragraph, Cover to make
it the cover image at the top, Save image, and Remove with Undo); Export (section 5) gets them all out at once. Images are shrunk to at
most 1600px and saved with the draft. When the draft has a placeholder like `[screenshot]`, take the shot
(`mcp__browser__screenshot` with `save_to` in the piece's folder; hover the header first so the click marker isn't in
it), and add a note with `"image": "file.png"`, the placeholder as its `anchor` and the caption as its `fix`: its
button reads Add image. To put an image next to a paragraph without removing words, add `"place": "after"` (or
`"before"`) and anchor the paragraph's last (or first) words. Prefer real artifacts (the source document, a chart
of the cited numbers) over generated pictures; look at every generated image before offering it. Copy text writes each image as `[Image: caption]` so the user knows where it goes.

Look for what a draft's growth leaves behind: a question raised and never answered, an argument tossed aside in a
clause, new typos in the new paragraphs.

## 5. Getting the piece out (publishing)

Never ask the user to save images one by one: pasted and dropped images live only in the page's saved copy, which you
can't read. The page exports them for you. In Weft, the editor writes `export/` beside itself on load and after every
save:

```
~/.weft/show/copy-edit/<slug>/export/piece.md        # title, cover first, ![caption](images/NN-slug.png), *caption*, **label**
~/.weft/show/copy-edit/<slug>/export/images/01-cover-lets-dance.png, 02-…   # reading order, named from captions
```

The user's Substack header and footer (an intro and a sign-off, edited in the dashed boxes above and below the text,
kept for every piece) go around the body in `piece.md` with `---` dividers; empty ones are left out. Don't paste your own.
An image already on the web (a Substack CDN url) stays a link in `piece.md`, with no file.

To publish: open (or reload) the page with `mcp__browser__open_url` so it writes a fresh export, wait a couple of
seconds, then read `export/piece.md` and upload the files under `export/images/` in the order the markdown names them
(the cover goes in the platform's cover slot). If `export/` doesn't appear, the running Weft predates the export bridge:
ask the user to click **Export** once, which downloads one `<slug>.zip` with the same files, and unzip it into a new
empty folder. Look at each image before you post it.

After it's published, the post is the source of truth. To bring it back into the editor, read Substack's public API
(`https://<pub>.substack.com/api/v1/posts?limit=…`, the post's `body_html`), convert it to the editor's blocks (figures with
the `substack-post-media` url and caption, h1/h2, p with links, lists; drop the subscribe and share widgets), save the old
page as `index-vN.html` and bump `data-key` past any key the pane may already hold a saved copy under.

## 6. In the reply

Short: the two or three big-picture notes in a sentence each, and what you checked. The page carries the rest. Offer
a tightened version only if the user asks for one; when they do, put it in the same editor as a new page
(`<slug>-v2`), so they can compare.
