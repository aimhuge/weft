// Live playback for the welcome's HyperFrames compositions (intro.html, loop.html, beats.html), used only with ?live=1;
// the renderer never runs it (it seeks window.__timelines.root itself). It scales the 1920x800 stage to the frame, tells
// the parent window which beat is on screen ({ weft: "welcome", beat, t, jumped }: t is the page's time, so the welcome
// can keep the voiceover in step after a jump), and plays the timeline: on repeat, or with ?tour=1 once, then on to
// `next` with the same query, so the welcome runs intro → loop → beats → intro.
// The welcome's Back and Next (components/WelcomeTourBar.tsx) send { weft: "go", beat, page }: a beat on this page is a
// seek; one on another page loads that page with the beat as its #hash, and it seeks there as it starts.

// Word-by-word caption highlighting: each caption's words light in the amber accent as the voice reads them, the way
// captions read on video. The word times come from public/welcome/narration-<page>.words.json (scripts/narrate-lib.mjs
// writes one beside each track, spreading every line's words across that clip's measured length), so the highlight is
// in step with the audio that actually plays.
//
// Driven off tl.time(), never timers, so it seeks correctly both in the live page and in the rendered video (the
// renderer seeks the timeline frame by frame). `track` is the composition's narration track name ("beats", "loop",
// "intro"); the lines and their word times come from that track's words file, so the copy lives in exactly one place
// (scripts/narrate-welcome.mjs). Captions are matched to lines in order, and a page with no words file gets no
// highlight at all — the captions simply stay plain.
window.weftCaptions = function (tl, caps, track, extra) {
  if (!caps.length) return;
  caps.forEach(function (cap) { cap.__words = splitWords(cap); cap.__line = -1; });
  // `extra` is [[element, sceneStart], ...] for text outside the caption band that still lights with the voice
  // (a big statement over a scene, say). It lights from the line that starts at its scene's time. A caption can also
  // carry its own data-scene, the cue of its line, when one scene speaks several (beats.html's keyboard scene).
  var others = (extra || []).map(function (pair) {
    return { el: pair[0], words: splitWords(pair[0]), at: pair[1] };
  });

  // Split a caption into per-word spans in reading order, keeping its <b> accents and any <br> where they are.
  // Each text node is replaced by its spans (not copied beside them), so a word shows once.
  function splitWords(cap) {
    var words = [];
    Array.prototype.slice.call(cap.childNodes).forEach(function (child) {
      if (child.nodeName === "BR") return;
      if (child.nodeType !== 3 && child.nodeName !== "B") return;
      var text = child.textContent;
      var pieces = text.split(/(\s+)/).filter(function (piece) { return piece; });
      // Build the spans off to the side, then swap the original text node for them.
      var made = pieces.map(function (piece) {
        var span = document.createElement("span");
        if (/^\s+$/.test(piece)) span.innerHTML = "&nbsp;";
        else { span.className = "w"; span.textContent = piece; words.push(span); }
        return span;
      });
      if (child.nodeType === 3) {
        made.forEach(function (span) { cap.insertBefore(span, child); });
        cap.removeChild(child);
      } else {
        child.textContent = "";
        made.forEach(function (span) { child.appendChild(span); });
      }
    });
    return words;
  }

  // The word under the playhead: the last one whose start has passed, inside this caption's own line.
  var byLine = [];
  function paint(t) {
    function light(words, times) {
      var lit = -1;
      if (times) for (var k = 0; k < times.length; k++) if (t >= times[k] && t < times[k + 1]) lit = k;
      words.forEach(function (w, k) { w.classList.toggle("lit", k === lit); });
    }
    caps.forEach(function (cap) { light(cap.__words, cap.__times); });
    others.forEach(function (o) { light(o.words, byLine[o.line]); });
  }
  var update = function () { if (byLine.length) paint(tl.time()); };
  tl.eventCallback("onUpdate", update);
  paint(tl.time());

  return fetch("./narration-" + track + ".words.json")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.words || !data.words.length) return;
      // Rebuild each line's word times as [start, nextStart, ...] from the flat [word, time] list, then hand each
      // caption the line whose cue it starts on.
      var from = 0;
      (data.lines || []).forEach(function (line) {
        var count = line[2].trim().split(/\s+/).length, span = data.words.slice(from, from + count).map(function (w) { return w[1]; });
        from += count;
        span.push(data.words[from] ? data.words[from][1] : Infinity);
        byLine.push(span);
      });
      // Match each caption to the line it speaks. A caption sits inside a scene that starts at time T (data-scene),
      // and the line for that scene cues at T — so the pair is by when it happens, not by where it sits in the DOM
      // (the Profile caption is above the quality one in the markup, but speaks after it).
      function nearest(t) {
        var best = 0;
        for (var i = 1; i < (data.lines || []).length; i++) {
          if (Math.abs(data.lines[i][0] - t) < Math.abs(data.lines[best][0] - t)) best = i;
        }
        return best;
      }
      caps.forEach(function (cap) {
        var scene = cap.closest("[data-scene]");
        cap.__line = scene ? nearest(Number(scene.getAttribute("data-scene"))) : -1;
        cap.__times = byLine[cap.__line] || null;
      });
      others.forEach(function (o) { o.line = nearest(o.at); });
      update();
    })
    .catch(function () { /* no word track: the captions stay plain */ });
};
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
