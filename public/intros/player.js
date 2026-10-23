// Live playback for the feature intros (public/intros/*.html), HyperFrames compositions like the welcome tour's: each
// page builds a paused GSAP timeline on window.__timelines.root and calls weftIntro(tl). It scales the 800x1000 stage to
// the frame's width and, with ?live=1, plays the timeline once. It tells the parent (components/FeatureIntro.tsx) when
// it starts and ends ({ weft: "intro", event: "start" | "done" }), so the parent starts the voiceover with it and
// offers Replay at the end; { weft: "intro-go" } from the parent plays it again from the top.
window.weftIntro = function (tl) {
  var root = document.getElementById("root");
  var fit = function () { root.style.transform = "scale(" + window.innerWidth / 800 + ")"; };
  fit();
  window.addEventListener("resize", fit);

  var post = function (event) {
    if (window.parent !== window) window.parent.postMessage({ weft: "intro", event: event }, "*");
  };
  var start = function () {
    tl.seek(0).play();
    post("start");
  };
  tl.eventCallback("onComplete", function () { post("done"); });
  window.addEventListener("message", function (e) {
    if (e.source === window.parent && e.data && e.data.weft === "intro-go") start();
  });
  // ?t=12 holds the frame at 12 s, for checking a scene by eye.
  var query = new URLSearchParams(location.search);
  if (query.has("t")) tl.seek(Number(query.get("t")) || 0).pause();
  else if (query.get("live") === "1") start();
};
