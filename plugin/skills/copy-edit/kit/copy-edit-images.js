// Copy-edit kit, images: Add image, paste or drop puts a <figure> (editable caption; ↑ ↓, Cover, Save image, Remove
// with Undo) after the paragraph you're in. Loaded before copy-edit.js, which calls window.CopyEditImages(api) with
// { doc, save, stat, toast } and gets back { figure, onClick, plainFigure }.
window.CopyEditImages = ({ doc, save, stat, toast }) => {
  const TOOLS = `<button class="fig-up" type="button" title="Move up">↑</button><button class="fig-down" type="button" title="Move down">↓</button><button class="fig-cover" type="button">Cover</button><a class="fig-save">Save image</a><button class="fig-x" type="button">Remove</button>`;

  // A figure the user can't type into, except its caption.
  function figure(src, caption) {
    const f = document.createElement("figure");
    f.contentEditable = "false";
    f.innerHTML = `<img alt=""><div class="fig-tools">${TOOLS}</div><figcaption contenteditable="true"></figcaption>`;
    f.querySelector("img").src = src;
    const a = f.querySelector(".fig-save");
    a.href = src;
    a.download = /^data:image\/png/.test(src) ? "image.png" : /^data:/.test(src) ? "image.jpg" : src.split("/").pop();
    f.querySelector("figcaption").textContent = caption || "";
    return f;
  }
  // Figures saved before a kit update keep their old toolbar: give them the current one.
  function upgrade(fig) {
    const tools = fig.querySelector(".fig-tools");
    if (!tools || tools.querySelector(".fig-up") && tools.querySelector(".fig-cover")) return;
    const save = tools.querySelector(".fig-save");
    tools.innerHTML = TOOLS;
    if (save) tools.querySelector(".fig-save").replaceWith(save);
  }
  doc.querySelectorAll("figure").forEach(upgrade);

  // Images are stored in the page's saved copy, so shrink them: at most 1600px wide, PNG when small, else JPEG.
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const png = c.toDataURL("image/png");
    return png.length < 900000 ? png : c.toDataURL("image/jpeg", 0.88);
  }
  // The top-level block the caret is in, so a new image lands after that paragraph (or at the end).
  function caretBlock() {
    const sel = getSelection();
    const node = sel.rangeCount ? sel.anchorNode : null;
    if (!node || !doc.contains(node)) return null;
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.parentElement !== doc) el = el.parentElement;
    return el;
  }
  async function addImages(files, block = caretBlock()) {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    let after = block;
    for (const file of images) {
      const f = figure(await shrink(file), "");
      if (after) after.after(f); else doc.append(f);
      after = f;
    }
    save();
    stat();
    after.scrollIntoView({ behavior: "smooth", block: "center" });
    after.querySelector("figcaption").focus();
  }
  const hasImage = (list) => [...list].some((i) => i.type.startsWith("image/"));
  doc.addEventListener("paste", (e) => {
    const files = e.clipboardData?.files;
    if (files && hasImage(files)) { e.preventDefault(); addImages(files); }
  });
  doc.addEventListener("dragover", (e) => { if (hasImage(e.dataTransfer.items)) e.preventDefault(); });
  doc.addEventListener("drop", (e) => {
    if (!hasImage(e.dataTransfer.files)) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (at) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(at); }
    addImages(e.dataTransfer.files);
  });

  // Toolbar: Add image, next to Copy text (older pages don't have the button in their HTML).
  const $ = (id) => document.getElementById(id);
  if (!$("addImage")) $("copy").insertAdjacentHTML("beforebegin", `<button id="addImage">Add image</button>`);
  const picker = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, hidden: true });
  document.body.append(picker);
  let pickAt = null;
  $("addImage").addEventListener("mousedown", () => { pickAt = caretBlock(); });
  $("addImage").onclick = () => picker.click();
  picker.onchange = async () => { await addImages(picker.files, pickAt); picker.value = ""; };

  // Move one paragraph up or down in reading order, however the browser nested things; skip empty lines.
  function move(fig, up) {
    const blocks = [...doc.querySelectorAll("p, figure, ol, ul, h2, h3, blockquote")].filter((b) =>
      (b === fig || !b.closest("figure")) && !b.parentElement.closest("ol, ul, blockquote") && (b.tagName === "FIGURE" || b.textContent.trim()));
    const target = blocks[blocks.indexOf(fig) + (up ? -1 : 1)];
    if (!target) return;
    if (up) target.before(fig); else target.after(fig);
    save();
    fig.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function remove(fig) {
    const before = fig.nextSibling, parent = fig.parentNode;
    fig.remove();
    save();
    stat();
    toast("Image removed", "Undo", () => { parent.insertBefore(fig, before); save(); stat(); });
  }
  // The cover sits above the text and goes in the platform's cover slot, not the body; one cover at most.
  function cover(fig) {
    const was = fig.classList.contains("cover");
    doc.querySelectorAll("figure.cover").forEach((f) => f.classList.remove("cover"));
    if (!was) { fig.classList.add("cover"); doc.prepend(fig); }
    save();
    fig.scrollIntoView({ behavior: "smooth", block: "center" });
    toast(was ? "No longer the cover" : "Set as the cover image");
  }
  // Handles a click on a figure's toolbar; returns true when it did.
  function onClick(e) {
    const btn = e.target.closest(".fig-up, .fig-down, .fig-x, .fig-cover");
    if (!btn) return false;
    const fig = btn.closest("figure");
    if (btn.matches(".fig-x")) remove(fig);
    else if (btn.matches(".fig-cover")) cover(fig);
    else move(fig, btn.matches(".fig-up"));
    return true;
  }
  // What Copy text writes in a figure's place.
  function plainFigure(el, clean) {
    const cap = clean(el.querySelector("figcaption")?.innerText || "");
    const kind = el.classList.contains("cover") ? "Cover image" : "Image";
    return cap ? `[${kind}: ${cap}]` : `[${kind}]`;
  }
  return { figure, onClick, plainFigure };
};
