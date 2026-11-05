// The control server's front door (electron/browser-pane.cjs): every request needs the launch's bearer token,
// and only a route in the table runs. Handlers get the JSON body and answer JSON; a throw is a 500 with its message.
const crypto = require("node:crypto");

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Constant-time, so the token can't be guessed a byte at a time from response timings.
function hasToken(header, token) {
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(String(header ?? ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function controlHandler({ token, routes }) {
  if (!token) throw new Error("The control server needs a token");
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!hasToken(req.headers.authorization, token)) return send(401, { error: "Unauthorized" });
    const key = `${req.method} ${req.url}`;
    const handler = Object.hasOwn(routes, key) ? routes[key] : undefined;
    if (!handler) return send(404, { error: "Not found" });
    try {
      // The route is part of what a handler sees: a request's card signature covers the route, so
      // one route's signature can't be replayed on another (electron/card-token.cjs).
      send(200, await handler(req.method === "POST" ? await readJson(req) : {}, req.url));
    } catch (err) {
      send(500, { error: err?.message || String(err) });
    }
  };
}

module.exports = { controlHandler, hasToken };
