// Live playback for the welcome's HyperFrames compositions (intro.html, loop.html, beats.html), used only with ?live=1;
// the renderer never runs it (it seeks window.__timelines.root itself). It scales the 1920x800 stage to the frame, tells
// the parent window which beat is on screen ({ weft: "welcome", beat, t, jumped }: t is the page's time, so the welcome
// can keep the voiceover in step after a jump), and plays the timeline: on repeat, or with ?tour=1 once, then on to
// `next` with the same query, so the welcome runs intro → loop → beats → intro.
// The welcome's Back and Next (components/WelcomeTourBar.tsx) send { weft: "go", beat, page }: a beat on this page is a
// seek; one on another page loads that page with the beat as its #hash, and it seeks there as it starts.
window.weftLive = function (tl, beats, next) {
  var root = document.getElementById("root");
  var fit = function () { root.style.transform = "scale(" + window.innerWidth / 1920 + ")"; };
  fit();
  window.addEventListener("resize", fit);

  var last = null, jumped = false;
  gsap.ticker.add(function () {
    var t = tl.time(), now = beats[0][1];
    beats.forEach(function (b) { if (t >= b[0]) now = b[1]; });
    if (now === last && !jumped) return;
    last = now;
    if (window.parent !== window) window.parent.postMessage({ weft: "welcome", beat: now, t: t, jumped: jumped }, "*");
    jumped = false;
  });

  // Seeks to a beat on this page and says so; false when the beat isn't here. It lands 0.2 s in, where the scene before
  // has finished fading out, so a jump never shows two scenes at once.
  var seekTo = function (beat) {
    for (var i = 0; i < beats.length; i++) {
      if (beats[i][1] !== beat) continue;
      tl.seek(i === 0 ? 0 : beats[i][0] + 0.2).play();
      jumped = true;
      return true;
    }
    return false;
  };
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.weft !== "go" || typeof d.beat !== "string") return;
    if (seekTo(d.beat)) return;
    if (typeof d.page === "string" && /^[a-z]+\.html$/.test(d.page)) location.replace(d.page + location.search + "#" + encodeURIComponent(d.beat));
  });

  if (new URLSearchParams(location.search).get("tour") === "1" && next) {
    tl.eventCallback("onComplete", function () { location.replace(next + location.search); });
    tl.play();
  } else {
    tl.repeat(-1).play();
  }
  if (location.hash) seekTo(decodeURIComponent(location.hash.slice(1)));
};
