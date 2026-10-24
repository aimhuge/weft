// Live playback for the feature intros (public/intros/*.html), HyperFrames compositions like the welcome tour's: each
// page builds a paused GSAP timeline on window.__timelines.root and calls weftIntro(tl). It scales the 16:9 1600x900
// stage to the frame and, with ?live=1, plays the timeline once with its voiceover. It tells the parent
// (components/FeatureIntro.tsx) when it starts and ends ({ weft: "intro", event: "start" | "done" }), so the parent
// offers Replay at the end; { weft: "intro-go" } from the parent plays it again from the top.

// What each feature is for, in one line, on its splash poster. The poster is about the feature, so it says what
// the feature does rather than what Weft is. The id is the page's file name (public/intros/<id>.html).
var FEATURE_TAGS = {
  vault: "Your keys, encrypted in your Keychain",
  webhooks: "Your services, talking to Weft",
  vercel: "Deploy, and watch the logs",
  supabase: "Migrations, auth, functions, health",
  cloudflare: "Your Worker, deployed and watched",
  blastcp: "Your social media, on one queue",
  github: "Your issues, as cards on the board",
  skills: "New tricks for your AI to learn",
  services: "Your dev servers, and what they cost",
  quality: "A score, and the refactors behind it",
  leagues: "Thirty builders, one table"
};

// A better mark for the two features whose own icon doesn't carry at poster size: Vercel's is a plain triangle,
// and the code quality ring is drawn at a fifth of its opacity so it vanishes on the poster's ground. These are
// the poster's own marks; the drawer's icon is unchanged.
var FEATURE_MARKS = {
  vercel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" ' +
    'd="M12 3.5 22 20H2L12 3.5Z"/></svg>',
  quality: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" stroke="#f0b429" stroke-opacity="0.25" stroke-width="3"/>' +
    '<path d="M12 3a9 9 0 0 1 9 9" stroke="#f0b429" stroke-width="3" stroke-linecap="round"/></svg>'
};

// The feature an intro is about, taken from the page's own .head row: the drawer's icon and its name. The splash
// shows them, so you know which drawer you're about to watch. Returns null if the page has no head row.
var readFeature = function (root) {
  var head = root.querySelector(".head");
  if (!head) return null;
  var icon = head.querySelector(".ic");
  // The name is the head's text without the icon's — the icon tile holds a glyph or a drawing, and the glyph
  // would otherwise be read as part of the name ("🏆 Leagues").
  var name = head.textContent.replace(/\s+/g, " ").trim();
  if (icon) name = name.replace(icon.textContent.trim(), "").trim();
  if (!icon || !name) return null;
  // The icon tile holds either a drawing (an SVG, or an image) or a glyph as plain text — the drawers that have
  // no artwork of their own use an emoji. Either way the splash wants the drawing on its own, not the tile.
  var svg = icon.querySelector("svg");
  if (svg) return { name: name, icon: svg.outerHTML, glyph: "" };
  var img = icon.querySelector("img");
  if (img) return { name: name, icon: "", glyph: "", src: img.getAttribute("src") };
  var glyph = icon.textContent.trim();
  return { name: name, icon: "", glyph: glyph };
};

// The splash every intro opens on: an OG-style poster about the feature — its own icon big in the middle, its
// name under it, and a line saying what it's for. It's injected here rather than written into each page, so all
// eleven intros open the same way without each one carrying the markup.
//
// It plays on a master timeline with the page's own timeline nested under it, so the story starts after the splash
// clears instead of running underneath it — and the whole thing stays seekable (?t= holds a frame).
//
// Returns { master, lead }: the master is the timeline to play, and lead is how many seconds of splash come first.
var buildSplash = function (root, tl) {
  var SPLASH_HOLD = 1.5, SPLASH_FADE = 0.5;
  var lead = SPLASH_HOLD + SPLASH_FADE;
  var feature = readFeature(root);
  // The id is the page's file name, which is what the taglines are keyed by.
  var id = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
  var splash = document.createElement("div");
  splash.id = "splash";
  splash.className = "abs";
  // The mark shows whatever the drawer's own icon is: a drawing, an image, or a glyph — unless the poster has a
  // better mark of its own for that feature.
  var mark = FEATURE_MARKS[id] || "";
  if (!mark && feature) {
    mark = feature.icon ||
      (feature.src ? '<img src="' + feature.src + '" alt="">' : feature.glyph);
  }
  splash.innerHTML =
    '<div class="halo"></div>' +
    '<div class="mark">' + mark + '</div>' +
    '<div class="name">' + (feature ? feature.name : "") + '</div>' +
    '<div class="tag">' + (FEATURE_TAGS[id] || "") + '</div>' +
    '<div class="bar"><i></i></div>';
  root.appendChild(splash);

  var master = gsap.timeline({ paused: true });
  // The page's timeline becomes a child of the master, so it runs from its own t=0 at the master's t=lead. Each
  // page builds its timeline paused (so ?t= can hold a frame); a nested timeline only advances if it isn't
  // paused itself, so it's resumed here and the master is the only paused thing.
  master.add(tl, lead);
  tl.paused(false);
  master.fromTo(splash, { opacity: 1 }, { opacity: 1, duration: SPLASH_HOLD }, 0);
  master.to(splash, { opacity: 0, duration: SPLASH_FADE, ease: "power1.inOut" }, SPLASH_HOLD);
  master.fromTo(splash.querySelector(".mark"), { scale: 0.82, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.5)" }, 0);
  // The name comes in under the icon, then the line about what the feature does.
  master.fromTo(splash.querySelector(".name"), { opacity: 0, y: 34 },
    { opacity: 1, y: 0, duration: 0.55 }, 0.18);
  master.fromTo(splash.querySelector(".tag"), { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.5 }, 0.42);
  // The bar crawls across while the splash is up.
  master.fromTo(splash.querySelector(".bar i"), { x: "-100%" },
    { x: "250%", duration: SPLASH_HOLD, ease: "power1.inOut" }, 0.05);
  // The splash sits above the stage's own #fade, so it hands over cleanly.
  master.set(splash, { display: "none" }, lead + 0.01);
  return { master: master, lead: lead };
};

// Start the story once the voice is really playing (or has failed, or 4 s has passed), so the narration and
// the frames begin together. A voice later than that pulls the frames back to where it is, so its first words
// are never cut off.
//
// The voice's t=0 is the story's t=0, but the story sits behind the splash, so the voice starts `lead` in.
var startWithVoice = function (play, voice, lead, begin) {
  if (!voice) return begin();
  voice.currentTime = 0;
  // Already playing (a replay mid-way): the seek is enough, and "playing" won't fire again.
  if (!voice.paused) return begin();
  var started = false;
  var go = function () {
    if (started) return;
    started = true;
    clearTimeout(timer);
    begin();
  };
  var timer = setTimeout(go, 4000);
  voice.addEventListener("playing", function () {
    // The voice's own time is the story's time; the story sits `lead` in on the master timeline.
    if (started) play.seek(lead + voice.currentTime);
    else go();
  }, { once: true });
  voice.addEventListener("error", go, { once: true });
  voice.play().catch(go);
};

window.weftIntro = function (tl) {
  var root = document.getElementById("root");
  var query = new URLSearchParams(location.search);
  // The 1600x900 stage fits the frame whole, letterboxed if the frame isn't 16:9. With ?ratio=9:16 (the portrait
  // render) the stage is restacked into a 1600x2844 canvas by the portrait styles in kit.css, and scaled to fill
  // the tall frame, so the composition fills it instead of sitting in a black band.
  var portrait = query.get("ratio") === "9:16";
  if (portrait) document.documentElement.classList.add("portrait");
  var fit = function () {
    // The frame is the window, not the document: the portrait stage is 2844 px tall, so the document is far
    // taller than the window and reading the document's height would scale the stage to nothing.
    var w = window.innerWidth, h = window.innerHeight;
    var scale = portrait
      ? Math.min(w / 1600, h / 2844)
      : Math.min(w / 1600, h / 900);
    root.style.transform = portrait
      ? "translate(-50%, -50%) scale(" + scale + ")"
      : "scale(" + scale + ")";
  };
  fit();
  window.addEventListener("resize", fit);
  // The layout settles a beat after the script runs (the portrait stage grows the document), so fit again once
  // the page has loaded and on the next frame, or the stage is scaled to a viewport that has since changed.
  window.addEventListener("load", fit);
  requestAnimationFrame(fit);

  var splash = buildSplash(root, tl);
  var lead = splash.lead;
  // The page's timeline ends with a no-op that pins its length; the master inherits it, so the master runs
  // for the splash plus the whole story.
  var play = splash.master;

  var post = function (event) {
    if (window.parent !== window) window.parent.postMessage({ weft: "intro", event: event }, "*");
  };
  // Live, the page plays its own voice, the track beside it (<id>.m4a; ?muted=1 starts it muted). The board used to
  // start it on "start", but its window can be busy for seconds as a drawer opens, and the voice came in that late
  // while the frames ran on. The timeline waits for the voice to really play (or fail, or 4 s) so they start together,
  // and a voice later than that pulls the frames back to where it is, so its first words are never cut off.
  //
  // The voice's t=0 is the story's t=0, but the story sits behind the splash, so the voice starts `lead` in.
  var voice = null;
  if (query.get("live") === "1") {
    voice = new Audio(location.pathname.replace(/\.html$/, ".m4a"));
    voice.preload = "auto";
    voice.muted = query.get("muted") === "1";
  }
  var begin = function () {
    play.seek(0).play();
    post("start");
  };
  var start = function () {
    play.seek(0).pause();
    startWithVoice(play, voice, lead, begin);
  };
  play.eventCallback("onComplete", function () { post("done"); });
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.weft === "intro-go") start();
    if (e.data.weft === "intro-mute" && voice) voice.muted = !!e.data.muted;
  });
  // ?t=12 holds the frame at 12 s, for checking a scene by eye. The time is the story's own: the splash adds
  // `lead` on top, so ?t=0 shows the splash and ?t=2 shows the story two seconds in.
  if (query.has("t")) {
    var t = Number(query.get("t")) || 0;
    play.seek(t < lead ? t : lead + t).pause();
  }
  else if (query.get("live") === "1") start();
};
