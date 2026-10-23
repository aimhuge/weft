// Live playback for the welcome's two HyperFrames compositions (loop.html, beats.html), used only with ?live=1; the
// renderer never runs it (it seeks window.__timelines.root itself). It scales the 1920x800 stage to the frame, tells
// the parent window which beat is on screen ({ weft: "welcome", beat }) so components/WelcomeLoop.tsx can put a real
// Sign in with GitHub button over the profile beat, and plays the timeline: on repeat, or with ?tour=1 once, then on
// to `next` with the same query, so the welcome runs loop → beats → loop.
window.weftLive = function (tl, beats, next) {
  var root = document.getElementById("root");
  var fit = function () { root.style.transform = "scale(" + window.innerWidth / 1920 + ")"; };
  fit();
  window.addEventListener("resize", fit);

  var last = null;
  gsap.ticker.add(function () {
    var t = tl.time(), now = beats[0][1];
    beats.forEach(function (b) { if (t >= b[0]) now = b[1]; });
    if (now === last) return;
    last = now;
    if (window.parent !== window) window.parent.postMessage({ weft: "welcome", beat: now }, "*");
  });

  if (new URLSearchParams(location.search).get("tour") === "1" && next) {
    tl.eventCallback("onComplete", function () { location.replace(next + location.search); });
    tl.play();
  } else {
    tl.repeat(-1).play();
  }
};
