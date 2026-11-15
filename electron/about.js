// The About page's renderer (about.html): plain browser JS, allowed by the page's script-src 'self'.
// Everything arrives through window.weftAbout (about-preload.cjs).
(function () {
  var api = window.weftAbout;
  var $ = function (id) { return document.getElementById(id); };
  var lines = []; // plain-text twin of the page, for Copy details

  function archLabel(info) {
    if (info.platform !== "darwin") return info.arch;
    return info.arch === "arm64" ? "Apple silicon" : info.arch === "x64" ? "Intel" : info.arch;
  }

  function row(label, value, action) {
    var wrap = document.createElement("div");
    wrap.className = "row";
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    dd.textContent = value;
    if (action) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "link";
      b.textContent = action.label;
      b.addEventListener("click", action.run);
      dd.appendChild(b);
    }
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    $("details").appendChild(wrap);
    lines.push(label + ": " + value);
  }

  $("logs").addEventListener("click", function () { api.open("logs"); });

  api.info().then(function (info) {
    // "Weft™ v0.8.3" up top; the line under it names the exact build when a server patch adds to it.
    $("name").textContent = "Weft™ v" + info.appVersion;
    document.title = "About Weft v" + info.appVersion;
    $("version").textContent =
      (info.version === info.appVersion ? "" : "Build " + info.version + " · ") + archLabel(info);
    $("tagline").textContent = info.tagline;
    lines.push("Weft " + info.version + " (" + archLabel(info) + ")", "");
    row("Data", info.dataDir, { label: "Open", run: function () { api.open("data"); } });
    row("Build", info.packaged ? "Release" : "Development");
    row("Server", info.serverPort ? "127.0.0.1:" + info.serverPort : "Not running");
    row("PID", "App " + info.pid + (info.serverPid ? " · Server " + info.serverPid : ""));
    row("Electron", info.electron);
    row("Chromium", info.chrome);
    row("Node", info.node);
    row("Platform", info.platform + " " + info.arch);

    var copy = $("copy");
    copy.disabled = false;
    copy.addEventListener("click", function () {
      api.copy(lines.join("\n")).then(function () {
        copy.textContent = "Copied";
        setTimeout(function () { copy.textContent = "Copy details"; }, 1500);
      });
    });
  }, function (err) {
    $("version").textContent = "Couldn't read the app's details: " + (err && err.message ? err.message : err);
  });
})();
