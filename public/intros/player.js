// Live playback for the feature intros (public/intros/*.html), HyperFrames compositions like the welcome tour's: each
// page builds a paused GSAP timeline on window.__timelines.root and calls weftIntro(tl). It scales the 800x1000 stage to
// the frame's width and, with ?live=1, plays the timeline once with its voiceover. It tells the parent
// (components/FeatureIntro.tsx) when it starts and ends ({ weft: "intro", event: "start" | "done" }), so the parent
// offers Replay at the end; { weft: "intro-go" } from the parent plays it again from the top.
window.weftIntro = function (tl) {
  var root = document.getElementById("root");
  var query = new URLSearchParams(location.search);
  // ?ratio=9:16 renders the 800x1000 art on a 1080x1920 stage: the width drives the scale, and the authored
  // art is shifted down so it sits centred on the taller canvas. Anything else keeps the plain 800x1000 stage.
  var vertical = query.get("ratio") === "9:16";
  if (vertical) root.setAttribute("data-ratio", "9x16");
  var fit = function () {
    // Portrait fills the frame width; the 9:16 stage scales to height instead, so the authored 800x1000 art
    // keeps its proportions (scaling by width at that canvas makes the type overflow its boxes).
    var scale = vertical
      ? Math.min(window.innerHeight / 1920, window.innerWidth / 1080)
      : window.innerWidth / 800;
    // On the taller canvas the authored art is shifted down half the extra height so it sits centred. In CSS a
    // transform list applies right to left, so translateY here is scaled by the scale() to its left: dividing
    // by the scale keeps the on-screen shift at exactly 460px whatever the frame size.
    root.style.transform = vertical
      ? "scale(" + scale + ") translateY(" + (460 / scale) + "px)"
      : "scale(" + scale + ")";
  };
  fit();
  window.addEventListener("resize", fit);

  var post = function (event) {
    if (window.parent !== window) window.parent.postMessage({ weft: "intro", event: event }, "*");
  };
  // Live, the page plays its own voice, the track beside it (<id>.m4a; ?muted=1 starts it muted). The board used to
  // start it on "start", but its window can be busy for seconds as a drawer opens, and the voice came in that late
  // while the frames ran on. The timeline waits for the voice to really play (or fail, or 4 s) so they start together,
  // and a voice later than that pulls the frames back to where it is, so its first words are never cut off.
  var voice = null;
  if (query.get("live") === "1") {
    voice = new Audio(location.pathname.replace(/\.html$/, ".m4a"));
    voice.preload = "auto";
    voice.muted = query.get("muted") === "1";
  }
  var begin = function () {
    tl.seek(0).play();
    post("start");
  };
  var start = function () {
    tl.seek(0).pause();
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
      if (started) tl.seek(voice.currentTime);
      else go();
    }, { once: true });
    voice.addEventListener("error", go, { once: true });
    voice.play().catch(go);
  };
  tl.eventCallback("onComplete", function () { post("done"); });
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.weft === "intro-go") start();
    if (e.data.weft === "intro-mute" && voice) voice.muted = !!e.data.muted;
  });
  // ?t=12 holds the frame at 12 s, for checking a scene by eye.
  if (query.has("t")) tl.seek(Number(query.get("t")) || 0).pause();
  else if (query.get("live") === "1") start();
};
