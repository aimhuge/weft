// Copy-edit kit: turns a page with <article id="doc"> (the piece, flagged phrases wrapped in
// <mark data-n="N">) and <script type="application/json" id="notes"> into an editor with a notes sidebar.
// Load copy-edit-doc.js and copy-edit-images.js first; this file is the notes, the sidebar and saving.
// Notes JSON: { "N": { "t": "title", "q": "why (optional)", "fix": "replacement text or null", "typo": true?,
//   "anchor": "exact text to underline", "kind": "big" | "typo"?, "image": "file.png"?, "place": "before" | "after"? } }
// A note with an anchor (a later round's note) is underlined in the user's saved text on load, until applied or dismissed.
// A fix with blank lines adds paragraphs after the marked one; a "## Label" paragraph becomes a .tag label on the next.
// Mark classes: none = claim (yellow), "big" = big picture (red), "typo" = typo (blue).
// A note with "image" puts that image in on Apply, with its fix as the caption: in place of the marked text, or with
// "place", before or after the marked paragraph, keeping its words.
(() => {
  const { norm, anchor, labels, flatten } = window.CopyEditDoc;
  const doc = document.getElementById("doc");
  const NOTES = JSON.parse(document.getElementById("notes").textContent);
  const KEY = doc.dataset.key || "copy-edit:" + location.pathname;
  const ORIGINAL = doc.innerHTML;
  const saved = localStorage.getItem(KEY);
  if (saved) doc.innerHTML = saved;
  const DONE_KEY = KEY + ":done";
  const done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  const markDone = (n) => { done.add(n); localStorage.setItem(DONE_KEY, JSON.stringify([...done])); };

  const $ = (id) => document.getElementById(id);
  const notesEl = $("notes-list");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const markOf = (n) => doc.querySelector(`mark[data-n="${n}"]`);

  let t, toastTimer;
  function save() {
    $("saved").textContent = "saving…";
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, doc.innerHTML);
        $("saved").textContent = "saved";
      } catch {
        $("saved").textContent = "not saved: too big";
        toast("Too big to save. Remove an image, or use a smaller one");
      }
    }, 300);
  }
  function stat() {
    const w = doc.innerText.trim().split(/\s+/).filter(Boolean).length;
    $("stat").textContent = `${w} words · ${doc.querySelectorAll("mark").length} notes open`;
  }
  function toast(s, action, onAction) {
    const e = $("toast");
    e.textContent = s;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action;
      b.onclick = () => { onAction(); e.classList.remove("show"); };
      e.append(" ", b);
    }
    e.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => e.classList.remove("show"), action ? 6000 : 1500);
  }

  const flattened = flatten(doc), relabeled = labels(doc), tidied = flattened || relabeled;
  const images = window.CopyEditImages({ doc, save, stat, toast });
  for (const [n, o] of Object.entries(NOTES)) if (o.anchor && !done.has(n) && !markOf(n)) anchor(doc, n, o);

  const paras = (text) => text.split(/\n\s*\n/);
  const fixHtml = (fix) => paras(fix).map((part) =>
    part.startsWith("## ") ? `<span class="tag">${esc(part.slice(3))}</span>` : `<p>${esc(part)}</p>`).join("");

  // One note's buttons: Apply (or Add image) and Dismiss while open; Reopen once resolved, if its words are still there.
  function noteButtons(o, m) {
    if (!m) {
      const back = o.anchor && norm(doc.textContent).includes(norm(o.anchor));
      return `<span class='q'>resolved</span>${back ? `<button data-a="reopen">Reopen</button>` : ""}`;
    }
    const apply = o.fix || o.image ? `<button data-a="apply">${o.image ? "Add image" : "Apply"}</button>` : "";
    return `${apply}<button data-a="dismiss">Dismiss</button>`;
  }
  function noteCard(n, o) {
    const m = markOf(n);
    const d = document.createElement("div");
    d.className = "note" + (o.typo ? " typo" : "") + (m && m.classList.contains("big") ? " big" : "") + (m ? "" : " done");
    d.dataset.n = n;
    const why = o.q ? `<div class="why">${paras(o.q).map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : "";
    const img = o.image ? `<img class="fix-img" src="${esc(o.image)}" alt="">` : "";
    const fix = o.fix ? `<div class="fix">${fixHtml(o.fix)}</div>` : "";
    d.innerHTML = `<b>${n}. ${esc(o.t)}</b>${why}${img}${fix}<div class="row">${noteButtons(o, m)}</div>`;
    return d;
  }
  function render() {
    notesEl.innerHTML = "";
    const entries = Object.entries(NOTES).sort(([a], [b]) => !!markOf(b) - !!markOf(a));
    for (const [n, o] of entries) notesEl.appendChild(noteCard(n, o));
    stat();
  }

  function applyImage(n, m, block) {
    const o = NOTES[n], fig = images.figure(o.image, o.fix || "");
    if (o.place) { m.replaceWith(...m.childNodes); block[o.place](fig); }
    else if (norm(block.textContent).trim() === norm(m.textContent).trim()) block.replaceWith(fig);
    else { m.remove(); block.after(fig); }
  }
  // Replace the marked text with the fix's first paragraph; any more paragraphs follow it, "## Label" as labels.
  function applyText(n, m, block, a) {
    const parts = a === "apply" ? paras(NOTES[n].fix) : [m.textContent];
    m.replaceWith(document.createTextNode(parts.shift()));
    let after = block, label = null;
    for (const part of parts) {
      if (part.startsWith("## ")) { label = part.slice(3).trim(); continue; }
      const p = document.createElement("p");
      if (label) { p.insertAdjacentHTML("afterbegin", `<span class="tag">${esc(label)}</span>`); label = null; }
      p.append(part.trim());
      after.after(p);
      after = p;
    }
    labels(doc);
  }
  function act(n, a) {
    const m = markOf(n);
    if (!m) return;
    const block = m.closest("p, li") || m.parentElement;
    if (a === "apply" && NOTES[n].image) applyImage(n, m, block);
    else applyText(n, m, block, a);
    markDone(n);
    save();
    render();
  }
  // Undo a Dismiss (or an Apply whose words are still there): underline the note's anchor again.
  function reopen(n) {
    done.delete(n);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
    anchor(doc, n, NOTES[n]);
    save();
    render();
    if (!markOf(n)) toast("Its text is no longer in your draft");
    else highlight(n).m.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function highlight(n) {
    document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
    const m = markOf(n), c = notesEl.querySelector(`[data-n="${n}"]`);
    m && m.classList.add("active");
    c && c.classList.add("active");
    return { m, c };
  }

  notesEl.addEventListener("click", (e) => {
    const card = e.target.closest(".note");
    if (!card) return;
    const a = e.target.dataset.a;
    if (a === "reopen") return reopen(card.dataset.n);
    if (a) return act(card.dataset.n, a);
    const { m } = highlight(card.dataset.n);
    m && m.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  doc.addEventListener("click", (e) => {
    if (images.onClick(e)) return;
    const m = e.target.closest("mark");
    if (!m) return;
    const { c } = highlight(m.dataset.n);
    c && c.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  doc.addEventListener("input", () => { save(); stat(); });

  // Plain text for pasting into LinkedIn, email, etc: lists keep their numbers, .tag labels become their own line
  // exactly as the user wrote them (the page shows them in capitals; that's CSS only), images become [Image: caption].
  function plain() {
    const clean = (s) => s.replace(/[ \t]{2,}/g, " ").trim();
    return [...doc.children].map((el) => {
      if (el.tagName === "OL" || el.tagName === "UL")
        return [...el.children].map((li, i) => `${el.tagName === "OL" ? i + 1 + "." : "•"} ${clean(li.innerText)}`).join("\n");
      if (el.tagName === "FIGURE") return images.plainFigure(el, clean);
      const c = el.cloneNode(true);
      c.querySelectorAll(".tag").forEach((tag) => tag.replaceWith(tag.textContent.trim() + "\n"));
      return clean(c.innerText);
    }).filter(Boolean).join("\n\n");
  }
  $("copy").onclick = async () => { await navigator.clipboard.writeText(plain()); toast("Copied as plain text"); };
  $("applyTypos").onclick = () => { for (const [n, o] of Object.entries(NOTES)) if (o.typo) act(n, "apply"); toast("Typos fixed"); };
  $("reset").onclick = () => {
    if (!confirm("Discard your edits?")) return;
    doc.innerHTML = ORIGINAL;
    localStorage.removeItem(KEY);
    localStorage.removeItem(DONE_KEY);
    location.reload();
  };
  render();
  if (tidied) save();
  // Open notes are listed first: start the sidebar at the top, not where the browser left it last time.
  history.scrollRestoration = "manual";
  const top = () => { const aside = notesEl.closest("aside"); if (aside) aside.scrollTop = 0; };
  requestAnimationFrame(top);
  setTimeout(top, 300);
})();
