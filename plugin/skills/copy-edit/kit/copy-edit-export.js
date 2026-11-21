// Copy-edit kit, export: the piece as markdown plus its images, named in reading order from their captions
// (01-cover-lets-dance.png, 02-…), cover first. Two ways out:
// - Export (toolbar): one download, <slug>.zip with piece.md and images/.
// - In Weft, the same files go to export/ beside the page (window.weft.showExport, electron/show-export.cjs) on load
//   and after every save, so a thread reads them from disk instead of asking the user to save each image.
// A Substack header and footer, kept for every piece, go around the text (frames() below).
// copy-edit.js calls window.CopyEditExport({ doc, toast }) and gets back { sync }.
window.CopyEditExport = ({ doc, toast }) => {
  const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const slugOf = (s, words = 5) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).slice(0, words).join("-").slice(0, 48).replace(/-$/, "");
  const nbsp = (s) => s.replace(/ /g, " ");
  const caption = (fig) => nbsp(fig.querySelector("figcaption")?.textContent || "").replace(/\s+/g, " ").trim();

  // Every figure in reading order (the cover first, wherever it sits), with its file name and where its bytes are.
  function imagesOf() {
    const figs = [...doc.querySelectorAll("figure")].filter((f) => f.querySelector("img"));
    figs.sort((a, b) => b.classList.contains("cover") - a.classList.contains("cover"));
    return figs.map((fig, i) => {
      const img = fig.querySelector("img"), src = img.getAttribute("src") || "", cap = caption(fig);
      const data = /^data:([^;,]+);base64,/.exec(src);
      const ext = data ? EXT[data[1]] || "png" : (/\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.exec(src)?.[1] || "png").toLowerCase();
      const words = [fig.classList.contains("cover") ? "cover" : "", slugOf(cap)].filter(Boolean).join("-") || "image";
      // An image already on the web (a Substack CDN url) stays a link in piece.md: no file to write.
      const remote = /^https?:/i.test(src);
      const name = remote ? src : `images/${String(i + 1).padStart(2, "0")}-${words}.${ext}`;
      return { fig, img, src, cap, name, remote, base64: data ? src.slice(src.indexOf(",") + 1) : null };
    });
  }

  // One block's text: marks unwrapped, line breaks kept, a .tag label pulled out to go on its own bold line.
  function blockText(el) {
    const c = el.cloneNode(true);
    const tags = [...c.querySelectorAll(".tag")].map((t) => { const s = t.textContent.trim(); t.remove(); return s; });
    c.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    // A link keeps its address: [text](url) in markdown.
    c.querySelectorAll("a[href]").forEach((a) => a.replaceWith(`[${a.textContent}](${a.getAttribute("href")})`));
    const text = nbsp(c.textContent).replace(/[ \t]{2,}/g, " ").replace(/ *\n */g, "\n").trim();
    return { label: tags.filter(Boolean).join(" "), text };
  }
  function markdown(images) {
    const byFig = new Map(images.map((im) => [im.fig, im]));
    const figMd = (im) => `![${im.cap.replace(/[[\]]/g, "")}](${im.name})` + (im.cap ? `\n*${im.cap}*` : "");
    const cover = images.find((im) => im.fig.classList.contains("cover"));
    const title = document.title.replace(/^Editor\s*[—-]\s*/, "").trim();
    // As the page shows it: the header above the cover, the footer after the text.
    const [head, foot] = ["header", "footer"].map(frameText);
    // The title goes in front matter, so the piece's own # and ## headings keep their meaning.
    const out = [title ? `---\ntitle: ${JSON.stringify(title)}\n---` : "", head, head ? "---" : "", cover ? figMd(cover) : ""];
    for (const el of doc.children) {
      if (el.tagName === "FIGURE") { if (byFig.has(el) && byFig.get(el) !== cover) out.push(figMd(byFig.get(el))); continue; }
      if (el.tagName === "OL" || el.tagName === "UL") {
        out.push([...el.children].map((li, i) => `${el.tagName === "OL" ? `${i + 1}.` : "-"} ${blockText(li).text}`).join("\n"));
        continue;
      }
      const { label, text } = blockText(el);
      const lead = /^H[1-6]$/.test(el.tagName) ? "#".repeat(+el.tagName[1]) + " " : el.tagName === "BLOCKQUOTE" ? "> " : "";
      out.push([label ? `**${label}**` : "", text ? lead + text : ""].filter(Boolean).join("\n"));
    }
    if (foot) out.push("---", foot);
    return out.filter(Boolean).join("\n\n") + "\n";
  }

  // The bytes of an image that isn't a data: URL (a file beside the page): fetch it, else draw it on a canvas.
  async function bytesOf(im) {
    if (im.base64) return Uint8Array.from(atob(im.base64), (ch) => ch.charCodeAt(0));
    try { return new Uint8Array(await (await fetch(im.img.src)).arrayBuffer()); } catch { /* file: fetch can be refused */ }
    const c = Object.assign(document.createElement("canvas"), { width: im.img.naturalWidth, height: im.img.naturalHeight });
    c.getContext("2d").drawImage(im.img, 0, 0);
    const blob = await new Promise((done) => c.toBlob(done, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // A stored (uncompressed) zip: images are PNG/JPEG already, so deflate would gain nothing.
  const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], dir = [];
    let offset = 0;
    for (const { name, body } of files) {
      const n = enc.encode(name), crc = crc32(body);
      const head = (sig, extra) => {
        const h = new DataView(new ArrayBuffer(extra ? 46 : 30));
        h.setUint32(0, sig, true);
        const o = extra ? 2 : 0;
        if (extra) h.setUint16(4, 20, true);
        h.setUint16(4 + o, 20, true); h.setUint16(6 + o, 0x0800, true); h.setUint16(12 + o, 0x5a21, true);
        h.setUint32(14 + o, crc, true); h.setUint32(18 + o, body.length, true); h.setUint32(22 + o, body.length, true);
        h.setUint16(26 + o, n.length, true);
        if (extra) h.setUint32(42, offset, true);
        return new Uint8Array(h.buffer);
      };
      parts.push(head(0x04034b50, false), n, body);
      dir.push(head(0x02014b50, true), n);
      offset += 30 + n.length + body.length;
    }
    const size = dir.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...dir, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  const slug = () => (doc.dataset.key || "piece").replace(/-v\d+$/, "") || "piece";
  // Write export/ beside the page through Weft; resolves to its answer, or null outside Weft.
  async function writeBeside() {
    if (!window.weft?.showExport) return null;
    const images = imagesOf();
    const files = [{ name: "piece.md", text: markdown(images) },
      ...images.filter((im) => !im.remote).map((im) => (im.base64 ? { name: im.name, base64: im.base64 } : { name: im.name, from: im.src }))];
    const res = await window.weft.showExport(files).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    if (!res?.ok) console.warn("copy-edit export:", res?.error);
    return res;
  }
  let timer;
  function sync() { clearTimeout(timer); timer = setTimeout(writeBeside, 1200); }

  async function exportZip() {
    const images = imagesOf(), enc = new TextEncoder();
    const files = [{ name: "piece.md", body: enc.encode(markdown(images)) }];
    for (const im of images.filter((i) => !i.remote)) {
      try { files.push({ name: im.name, body: await bytesOf(im) }); } catch { toast(`Couldn't read ${im.name}`); }
    }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(zip(files)), download: `${slug()}.zip` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    const beside = await writeBeside();
    toast(`Exported piece.md + ${images.length} image${images.length === 1 ? "" : "s"}` + (beside?.ok ? ", also in export/ beside this page" : ""));
  }

  // Header and footer: your Substack intro and sign-off, written once and kept for every piece (localStorage is shared
  // by every page in the show folder), shown above and below the text and put around it in piece.md, with dividers.
  const FRAME_KEY = "copy-edit:frame:";
  const frameText = (which) => (localStorage.getItem(FRAME_KEY + which) || "").replace(/\n{3,}/g, "\n\n").trim();
  function frames() {
    if (document.querySelector(".frame")) return;
    const col = document.createElement("div");
    col.className = "col";
    doc.before(col);
    col.append(doc);
    for (const which of ["header", "footer"]) {
      const el = document.createElement("div");
      el.className = `frame frame-${which}`;
      el.contentEditable = "plaintext-only";
      el.dataset.label = `Substack ${which} · every piece`;
      el.dataset.empty = which === "header" ? "Your intro, above every piece you export (optional)" : "Your sign-off: subscribe line, links (optional)";
      el.innerText = frameText(which);
      el.addEventListener("input", () => { localStorage.setItem(FRAME_KEY + which, el.innerText); sync(); });
      if (which === "header") doc.before(el); else doc.after(el);
    }
  }
  frames();

  const copy = document.getElementById("copy");
  if (!document.getElementById("export")) copy.insertAdjacentHTML("beforebegin", `<button id="export" title="Download piece.md and every image as one .zip">Export</button>`);
  document.getElementById("export").onclick = exportZip;
  return { sync, markdown: () => markdown(imagesOf()) };
};
