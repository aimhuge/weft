// Cloudflare R2, the read copy of the weft-blobs bucket (docs/architecture/r2.md). Supabase Storage stays where
// blobs are written; lib/r2-mirror.ts copies each object here once, and readers get R2 URLs for the ones that
// are copied, because R2 charges nothing for egress and Supabase's free plan allows 5 GB a month.
//
// R2 speaks the S3 API, so this is AWS Signature Version 4 over node:crypto: a presigned GET for browsers
// (the share page, the web board) and header-signed PUT / GET for the server. No SDK: the signer is the whole
// client, and keeping it here keeps the read path free of a 3 MB dependency.
import { createHash, createHmac } from "node:crypto";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const REGION = "auto";
const SERVICE = "s3";
const UNSIGNED = "UNSIGNED-PAYLOAD";
// A presigned URL is signed at the top of the hour and lives two, so the same blob gets the same URL for an
// hour and the browser's cache keeps working across page loads. It is always valid for at least an hour.
const SIGN_WINDOW_S = 3600;
const PRESIGN_TTL_S = 7200;
// The keys are content hashes, so the bytes behind one never change.
export const R2_CACHE_CONTROL = "private, max-age=31536000, immutable";

/** The R2 settings from the environment, or null when any is missing or R2 is switched off (WEFT_BLOBS_R2=off). */
export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  if (env.WEFT_BLOBS_R2 === "off") return null;
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim() || "weft-blobs";
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function r2Host(cfg: R2Config): string {
  return `${cfg.accountId}.r2.cloudflarestorage.com`;
}

/** The object's key: the same `<org_id>/<sha256>` as in Supabase. */
export function r2Key(orgId: string, sha: string): string {
  return `${orgId}/${sha}`;
}

// RFC 3986 encoding, which SigV4 needs: encodeURIComponent leaves !'()* alone.
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectPath(cfg: R2Config, key: string): string {
  return `/${rfc3986(cfg.bucket)}/${key.split("/").map(rfc3986).join("/")}`;
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s).digest();

// 20261029T160000Z and 20261029.
function stamps(at: Date): { amzDate: string; day: string } {
  const amzDate = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function scopeOf(day: string): string {
  return `${day}/${REGION}/${SERVICE}/aws4_request`;
}

function signature(cfg: R2Config, day: string, stringToSign: string): string {
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), "aws4_request");
  return createHmac("sha256", kSigning).update(stringToSign).digest("hex");
}

function stringToSign(amzDate: string, day: string, canonical: string): string {
  return ["AWS4-HMAC-SHA256", amzDate, scopeOf(day), sha256Hex(canonical)].join("\n");
}

/**
 * A presigned GET URL for one object, for a browser to load directly. The caller has already checked that
 * the reader may see it (org membership, or a live share): the URL itself is the only check R2 makes.
 */
export function presignGet(cfg: R2Config, key: string, now = Date.now()): string {
  const signedAt = new Date(Math.floor(now / 1000 / SIGN_WINDOW_S) * SIGN_WINDOW_S * 1000);
  const { amzDate, day } = stamps(signedAt);
  const host = r2Host(cfg);
  const path = objectPath(cfg, key);
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scopeOf(day)}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(PRESIGN_TTL_S)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = params
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .sort()
    .join("&");
  const canonical = ["GET", path, query, `host:${host}`, "", "host", UNSIGNED].join("\n");
  const sig = signature(cfg, day, stringToSign(amzDate, day, canonical));
  return `https://${host}${path}?${query}&X-Amz-Signature=${sig}`;
}

/** The headers for a server-side request, signed with SigV4 over host, the payload hash and the date. */
export function signedHeaders(cfg: R2Config, method: string, key: string, extra: Record<string, string> = {}, now = Date.now()): Record<string, string> {
  const { amzDate, day } = stamps(new Date(now));
  const host = r2Host(cfg);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": UNSIGNED, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(extra)) headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const canonical = [method, objectPath(cfg, key), "", canonicalHeaders, names.join(";"), UNSIGNED].join("\n");
  const sig = signature(cfg, day, stringToSign(amzDate, day, canonical));
  // fetch sets Host itself; it's signed, not sent.
  const rest = Object.fromEntries(Object.entries(headers).filter(([n]) => n !== "host"));
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scopeOf(day)}, SignedHeaders=${names.join(";")}, Signature=${sig}` };
}

function objectUrl(cfg: R2Config, key: string): string {
  return `https://${r2Host(cfg)}${objectPath(cfg, key)}`;
}

/** Writes one object. Content-addressed, so writing the same key twice is harmless. */
export async function r2Put(cfg: R2Config, key: string, body: ArrayBuffer | Uint8Array, contentType: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const headers = signedHeaders(cfg, "PUT", key, { "content-type": contentType, "cache-control": R2_CACHE_CONTROL });
  const res = await fetchImpl(objectUrl(cfg, key), { method: "PUT", headers, body: body as BodyInit });
  if (!res.ok) throw new Error(`R2 answered ${res.status} writing ${key}.`);
}

/** Reads one object's bytes and type, or null when it isn't there (or R2 can't be reached). */
export async function r2Get(cfg: R2Config, key: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    const res = await fetchImpl(objectUrl(cfg, key), { headers: signedHeaders(cfg, "GET", key) });
    if (!res.ok) return null;
    return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}
