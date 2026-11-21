// Copy-edit kit, text helpers: matching, underlining and tidying the article. Loaded before copy-edit.js, which uses
// window.CopyEditDoc. Nothing here knows about notes' UI.
(() => {
  // Typing in a contenteditable leaves non-breaking spaces, and dashes come in several widths: match them as plain
  // ones. Each swap is one character for one, so offsets into the original text still line up.
  const norm = (t) => t.replace(/ /g, " ").replace(/[–—−]/g, "-");

  function makeMark(n, o) {
    const m = document.createElement("mark");
    m.dataset.n = n;
    const kind = o.kind || (o.typo ? "typo" : "");
    if (kind) m.className = kind;
    return m;
  }

  // The range covering text offset [at, stop) across a block's text nodes.
  function rangeIn(block, at, stop) {
    const r = document.createRange();
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let pos = 0, started = false;
    for (let t; (t = w.nextNode()); ) {
      const len = t.data.length;
      if (!started && at < pos + len) { r.setStart(t, at - pos); started = true; }
      if (started && stop <= pos + len) { r.setEnd(t, stop - pos); break; }
      pos += len;
    }
    return r;
  }

  // Underline the anchor text: first inside one text node, else across nodes within one paragraph or list item
  // (a later note that covers an earlier note's mark absorbs it; that note shows as resolved until its text returns).
  function anchor(doc, n, o) {
    const want = norm(o.anchor);
    const walk = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    for (let node; (node = walk.nextNode()); ) {
      if (node.parentElement.closest("mark")) continue;
      const i = norm(node.data).indexOf(want);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + o.anchor.length);
      r.surroundContents(makeMark(n, o));
      return;
    }
    for (const block of doc.querySelectorAll("p, li")) {
      const at = norm(block.textContent).indexOf(want);
      if (at < 0) continue;
      const r = rangeIn(block, at, at + o.anchor.length);
      const frag = r.extractContents();
      frag.querySelectorAll("mark").forEach((inner) => inner.replaceWith(...inner.childNodes));
      const m = makeMark(n, o);
      m.append(frag);
      r.insertNode(m);
      block.querySelectorAll("mark").forEach((empty) => { if (!empty.textContent) empty.remove(); });
      return;
    }
  }

  // A "## Label" paragraph becomes the small .tag label at the start of the paragraph after it.
  function labels(doc) {
    let changed = false;
    for (const p of [...doc.querySelectorAll("p")]) {
      const text = p.textContent.trim();
      const next = p.nextElementSibling;
      if (!text.startsWith("## ") || !next || next.tagName !== "P") continue;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = text.slice(3).trim();
      next.prepend(tag);
      p.remove();
      changed = true;
    }
    return changed;
  }

  // Split a paragraph's child nodes at blank lines (two or more <br>, whitespace between allowed).
  function splitAtBlankLines(p) {
    const nodes = [...p.childNodes], parts = [[]];
    const isBr = (k) => nodes[k]?.nodeName === "BR";
    const blank = (k) => nodes[k]?.nodeType === 3 && !nodes[k].data.trim();
    for (let i = 0; i < nodes.length; i++) {
      if (isBr(i)) {
        let j = i + 1;
        while (blank(j)) j++;
        if (isBr(j)) { while (isBr(j) || blank(j)) j++; parts.push([]); i = j - 1; continue; }
      }
      parts.at(-1).push(nodes[i]);
    }
    return parts.filter((part) => part.some((nd) => nd.textContent.trim() || nd.nodeName === "IMG"));
  }

  // Typing in a contenteditable can wrap paragraphs in a <div>, make a bare <div> line, or put a blank line inside a
  // paragraph. Flatten all three so every paragraph and image is a direct child of the article: placing and moving
  // images then works paragraph by paragraph.
  function flatten(doc) {
    let changed = false;
    for (const div of [...doc.querySelectorAll(":scope > div")]) {
      if (div.querySelector("p, figure, ol, ul, div, blockquote")) div.replaceWith(...div.childNodes);
      else { const p = document.createElement("p"); p.append(...div.childNodes); div.replaceWith(p); }
      changed = true;
    }
    for (const p of [...doc.querySelectorAll(":scope > p")]) {
      const kept = splitAtBlankLines(p);
      if (kept.length < 2) continue;
      p.replaceWith(...kept.map((part) => { const np = document.createElement("p"); np.append(...part); return np; }));
      changed = true;
    }
    if (changed) flatten(doc);
    return changed;
  }

  window.CopyEditDoc = { norm, anchor, labels, flatten };
})();
