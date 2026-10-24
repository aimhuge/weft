// The deployed Weft's origin, for the URLs Stripe sends a customer back to.
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL || "https://weft.zip").replace(/\/+$/, "");
}
