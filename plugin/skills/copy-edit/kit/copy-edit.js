// Copy-edit kit: turns a page with <article id="doc"> (the piece, flagged phrases wrapped in
// <mark data-n="N">) and <script type="application/json" id="notes"> into an editor with a notes sidebar.
// Notes JSON: { "N": { "t": "title", "q": "why (optional)", "fix": "replacement text or null", "typo": true?,
//   "anchor": "exact text to underline", "kind": "big" | "typo"? } }
// A note with an anchor (a later round's note) is underlined in the user's saved text on load, until applied or dismissed.
// A fix with blank lines adds paragraphs after the marked one; a "## Label" paragraph becomes a .tag label on the next.
// Mark classes: none = claim (yellow), "big" = big picture (red), "typo" = typo (blue).
(() => {
  const doc = document.getElementById("doc");
  const NOTES = JSON.parse(document.getElementById("notes").textContent);
  const KEY = doc.dataset.key || "copy-edit:" + location.pathname;
  const ORIGINAL = doc.innerHTML;
  const saved = localStorage.getItem(KEY);
  if (saved) doc.innerHTML = saved;
  const DONE_KEY = KEY + ":done";
  const done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));

  function anchor(n, o) {
    const walk = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    for (let node; (node = walk.nextNode()); ) {
      if (node.parentElement.closest("mark")) continue;
      const i = node.data.indexOf(o.anchor);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + o.anchor.length);
      const m = document.createElement("mark");
      m.dataset.n = n;
      const kind = o.kind || (o.typo ? "typo" : "");
      if (kind) m.className = kind;
      r.surroundContents(m);
      return;
    }
  }

  const $ = (id) => document.getElementById(id);
  const notesEl = $("notes-list");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const markOf = (n) => doc.querySelector(`mark[data-n="${n}"]`);
  function labels() {
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
  const relabeled = labels();
  for (const [n, o] of Object.entries(NOTES)) if (o.anchor && !done.has(n) && !markOf(n)) anchor(n, o);

  const fixHtml = (fix) => fix.split(/\n\s*\n/).map((part) =>
    part.startsWith("## ") ? `<span class="tag">${esc(part.slice(3))}</span>` : `<p>${esc(part)}</p>`).join("");

  function render() {
    notesEl.innerHTML = "";
    const entries = Object.entries(NOTES).sort(([a], [b]) => !!markOf(b) - !!markOf(a));
    for (const [n, o] of entries) {
      const m = markOf(n);
      const d = document.createElement("div");
      d.className = "note" + (o.typo ? " typo" : "") + (m && m.classList.contains("big") ? " big" : "") + (m ? "" : " done");
      d.dataset.n = n;
      d.innerHTML = `<b>${n}. ${esc(o.t)}</b>${o.q ? `<div class="q">${esc(o.q)}</div>` : ""}${o.fix ? `<div class="fix">${fixHtml(o.fix)}</div>` : ""}
        <div class="row">${m && o.fix ? `<button data-a="apply">Apply</button>` : ""}${m ? `<button data-a="dismiss">Dismiss</button>` : "<span class='q'>resolved</span>"}</div>`;
      notesEl.appendChild(d);
    }
    stat();
  }
  function act(n, a) {
    const m = markOf(n);
    if (!m) return;
    const parts = a === "apply" ? NOTES[n].fix.split(/\n\s*\n/) : [m.textContent];
    const block = m.closest("p, li") || m.parentElement;
    m.replaceWith(document.createTextNode(parts.shift()));
    let after = block, label = null;
    for (const part of parts) {
      if (part.startsWith("## ")) { label = part.slice(3).trim(); continue; }
      const p = document.createElement("p");
      if (label) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = label;
        p.append(tag);
        label = null;
      }
      p.append(part.trim());
      after.after(p);
      after = p;
    }
    labels();
    done.add(n);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
    save();
    render();
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
    if (a) return act(card.dataset.n, a);
    const { m } = highlight(card.dataset.n);
    m && m.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  doc.addEventListener("click", (e) => {
    const m = e.target.closest("mark");
    if (!m) return;
    const { c } = highlight(m.dataset.n);
    c && c.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  let t;
  function save() {
    $("saved").textContent = "saving…";
    clearTimeout(t);
    t = setTimeout(() => { localStorage.setItem(KEY, doc.innerHTML); $("saved").textContent = "saved"; }, 300);
  }
  function stat() {
    const w = doc.innerText.trim().split(/\s+/).filter(Boolean).length;
    $("stat").textContent = `${w} words · ${doc.querySelectorAll("mark").length} notes open`;
  }
  doc.addEventListener("input", () => { save(); stat(); });

  function toast(s) {
    const e = $("toast");
    e.textContent = s;
    e.classList.add("show");
    setTimeout(() => e.classList.remove("show"), 1500);
  }
  // Plain text for pasting into LinkedIn, email, etc: lists keep their numbers, .tag labels become their own line.
  function plain() {
    const clean = (s) => s.replace(/[ \t]{2,}/g, " ").trim();
    return [...doc.children].map((el) => {
      if (el.tagName === "OL" || el.tagName === "UL")
        return [...el.children].map((li, i) => `${el.tagName === "OL" ? i + 1 + "." : "•"} ${clean(li.innerText)}`).join("\n");
      const c = el.cloneNode(true);
      c.querySelectorAll(".tag").forEach((tag) => tag.replaceWith((tag.dataset.plain || tag.textContent) + "\n"));
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
  if (relabeled) save();
})();
