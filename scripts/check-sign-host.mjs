// Post-deploy check of sign.weft.zip (docs/architecture/mobile-security.md, "Passkey approvals"): its two pages answer
// with the strict CSP, everything else on it is a 404 (with the CSP too), and weft.zip doesn't serve the sign files.
// Run after the domain is live: `node scripts/check-sign-host.mjs [sign origin] [weft.zip origin]`. Exits 1 on a miss.
const sign = process.argv[2] ?? "https://sign.weft.zip";
const site = process.argv[3] ?? "https://weft.zip";

const CSP_PARTS = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"];

const checks = [
  { url: `${sign}/pair`, status: 200, csp: true },
  { url: `${sign}/approve`, status: 200, csp: true },
  { url: `${sign}/app.js`, status: 200, csp: true },
  { url: `${sign}/_next/static/chunks/main.js`, status: 404, csp: true },
  { url: `${sign}/api/cards`, status: 404, csp: true },
  { url: `${sign}/logo.svg`, status: 404, csp: true },
  { url: `${sign}/sign/app.js`, status: 404, csp: true },
  { url: `${sign}/`, status: 404, csp: true },
  { url: `${site}/sign/pair.html`, status: 404, csp: false },
  { url: `${site}/sign/app.js`, status: 404, csp: false },
];

let failed = 0;
for (const { url, status, csp } of checks) {
  const res = await fetch(url, { redirect: "manual" });
  const header = res.headers.get("content-security-policy") ?? "";
  const problems = [];
  if (res.status !== status) problems.push(`status ${res.status}, wanted ${status}`);
  if (csp) {
    const missing = CSP_PARTS.filter((p) => !header.includes(p));
    if (missing.length) problems.push(`CSP missing ${missing.join(", ")}`);
    if (header.includes("unsafe-inline")) problems.push("CSP allows 'unsafe-inline'");
  }
  failed += problems.length ? 1 : 0;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${url}${problems.length ? `: ${problems.join("; ")}` : ""}`);
}
console.log(failed ? `${failed} of ${checks.length} checks failed.` : `All ${checks.length} checks passed.`);
process.exit(failed ? 1 : 0);
