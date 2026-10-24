// Live playback for the feature intros (public/intros/*.html), HyperFrames compositions like the welcome tour's: each
// page builds a paused GSAP timeline on window.__timelines.root and calls weftIntro(tl). It scales the 16:9 1600x900
// stage to the frame and, with ?live=1, plays the timeline once with its voiceover. It tells the parent
// (components/FeatureIntro.tsx) when it starts and ends ({ weft: "intro", event: "start" | "done" }), so the parent
// offers Replay at the end; { weft: "intro-go" } from the parent plays it again from the top.

// The splash every intro opens on: the Weft mark over the wordmark, a bar underneath, on the stage's dark ground.
// It's injected here rather than written into each page, so all eleven intros open the same way.
//
// It plays on a master timeline with the page's own timeline nested under it, so the story starts after the splash
// clears instead of running underneath it — and the whole thing stays seekable (?t= holds a frame).
//
// Returns { master, lead }: the master is the timeline to play, and lead is how many seconds of splash come first.
var buildSplash = function (root, tl) {
  var SPLASH_HOLD = 1.1, SPLASH_FADE = 0.45;
  var lead = SPLASH_HOLD + SPLASH_FADE;
  var splash = document.createElement("div");
  splash.id = "splash";
  splash.className = "abs";
  splash.innerHTML =
    '<img class="mark" src="../logo.svg" alt="">' +
    '<div class="word">Weft</div>' +
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
  master.fromTo(splash.querySelector(".mark"), { scale: 0.86, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.6)" }, 0);
  master.fromTo(splash.querySelector(".word"), { opacity: 0, y: 18 },
    { opacity: 1, y: 0, duration: 0.5 }, 0.15);
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
