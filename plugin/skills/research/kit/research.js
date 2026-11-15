// Weft research pages (plugin/skills/research): lights up what belongs to the latest round, folds everything else
// (living blocks this round didn't change to their title and summary, earlier rounds to their TL;DR), and builds the bar.
// The latest round is the highest data-round on a .round section. Anything carrying that data-round (a living
// block, a mark) gets .now; living blocks get a "changed in round N" chip. Weft's mcp__browser__focus does the
// scrolling and the flash, so this script never moves the page itself.
(function () {
  // A research page counts rounds; a builder thread's page counts turns (<body data-unit="Turn">). Same kit (README.md).
  const UNIT = document.body.dataset.unit || "Round";
  const rounds = [...document.querySelectorAll("section.round[data-round]")];
  const living = [...document.querySelectorAll("section.living[id]")];
  const latest = rounds.reduce((n, r) => Math.max(n, Number(r.dataset.round) || 0), 0);
  const isLatest = (el) => Number(el.dataset.round) === latest;

  document.querySelectorAll("[data-round]").forEach((el) => {
    if (isLatest(el)) el.classList.add("now");
  });
  rounds.forEach(divider);
  living.forEach(label);
  bar();
  openTarget();
  window.addEventListener("hashchange", openTarget);
  fadeOnceSeen();

  // The round's divider: when, and what was asked. An earlier round's opens and folds on a tap.
  function divider(r) {
    if (r.querySelector(":scope > .rr-divider")) return;
    const d = document.createElement("div");
    d.className = "rr-divider";
    d.innerHTML = '<div class="rr-when"></div><div class="rr-asked"></div>';
    const when = r.dataset.when ? " · " + r.dataset.when : "";
    d.firstChild.textContent = `${UNIT} ${r.dataset.round}${when}${isLatest(r) ? " · new" : ""}`;
    d.lastChild.textContent = r.dataset.asked ? `“${r.dataset.asked}”` : "";
    if (!isLatest(r)) d.onclick = () => r.classList.toggle("open");
    r.prepend(d);
  }

  // A living block's "changed in round N" chip and its title.
  function label(b) {
    if (b.dataset.round && !b.querySelector(":scope > .rr-chip")) {
      const c = document.createElement("span");
      c.className = "rr-chip";
      c.textContent = isLatest(b) ? `changed in round ${b.dataset.round}` : `round ${b.dataset.round}`;
      b.prepend(c);
    }
    if (!b.dataset.title || b.querySelector(":scope > .rr-title")) return;
    const t = document.createElement("div");
    t.className = "rr-title";
    t.textContent = b.dataset.title;
    t.onclick = () => b.classList.toggle("open");
    const chip = b.querySelector(":scope > .rr-chip");
    if (chip) chip.after(t);
    else b.prepend(t);
    if (b.dataset.summary && !b.querySelector(":scope > .rr-sum")) {
      const sum = document.createElement("div");
      sum.className = "rr-sum";
      sum.textContent = b.dataset.summary;
      t.after(sum);
    }
  }

  // A link or a focus on something inside a fold opens that fold, so a jump never lands on a closed box.
  function openTarget() {
    if (!location.hash) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    el?.closest(".living, .round")?.classList.add("open");
  }

  // The sticky bar: Top, each living block and each round, with what changed this round lit.
  function bar() {
    const nav = document.createElement("nav");
    nav.className = "rr-bar";
    const link = (href, text, now) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = text;
      if (now) a.className = "now";
      nav.append(a);
    };
    link("#top", "Top", false);
    for (const b of living) link(`#${b.id}`, b.dataset.title || b.id, isLatest(b));
    for (const r of rounds) link(`#${r.id}`, `${UNIT} ${r.dataset.round}`, isLatest(r));
    document.body.prepend(nav);
  }

  // This round's marks fade to quiet once they've been on screen for SEEN_MS, so a fade only happens where you
  // were looking. A mark you never scrolled to stays bright.
  function fadeOnceSeen() {
    const SEEN_MS = 4000;
    if (!("IntersectionObserver" in window)) return;
    const timers = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !timers.has(e.target)) {
          timers.set(e.target, setTimeout(() => { e.target.classList.add("seen"); io.unobserve(e.target); }, SEEN_MS));
        } else if (!e.isIntersecting && timers.has(e.target)) {
          clearTimeout(timers.get(e.target));
          timers.delete(e.target);
        }
      }
    }, { threshold: 1 });
    document.querySelectorAll("mark.now").forEach((m) => io.observe(m));
  }
})();
