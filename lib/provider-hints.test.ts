import { describe, expect, it } from "vitest";
import { providerHint } from "./provider-hints";

describe("providerHint", () => {
  it("gives the specific Stripe webhook hint before the Stripe catch-all", () => {
    expect(providerHint("STRIPE_WEBHOOK_SECRET")).toContain("Webhooks");
    expect(providerHint("STRIPE_WEBHOOK_SECRET")).not.toContain("API keys");
  });

  it.each([
    ["STRIPE_API_KEY", "Stripe"],
    ["SUPABASE_SERVICE_KEY", "Supabase"],
    ["DATABASE_URL", "database"],
    ["ANTHROPIC_API_KEY", "Anthropic"],
    ["OPENAI_API_KEY", "OpenAI"],
    ["RESEND_API_KEY", "Resend"],
    ["CLERK_SECRET_KEY", "Clerk"],
    ["GITHUB_CLIENT_SECRET", "OAuth"],
    ["GITHUB_TOKEN", "Personal access tokens"],
    ["GOOGLE_API_KEY", "Google Cloud"],
    ["POSTHOG_API_KEY", "PostHog"],
    ["SENTRY_AUTH_TOKEN", "Sentry"],
    ["VERCEL_TOKEN", "Vercel"],
    ["CLOUDFLARE_API_TOKEN", "Cloudflare"],
    ["CF_API_TOKEN", "Cloudflare"],
    ["UPSTASH_REDIS_REST_TOKEN", "Upstash"],
    ["REDIS_URL", "Upstash"],
    ["TWILIO_AUTH_TOKEN", "Twilio"],
    ["SENDGRID_API_KEY", "SendGrid"],
    ["ELEVENLABS_API_KEY", "ElevenLabs"],
    ["REPLICATE_API_TOKEN", "Replicate"],
    ["SLACK_TOKEN", "Slack"],
    ["AWS_ACCESS_KEY_ID", "AWS"],
  ])("gives a hint for %s", (name, provider) => {
    expect(providerHint(name)).toContain(provider);
  });

  it("returns undefined for an unknown name", () => {
    expect(providerHint("SOME_OTHER_NAME")).toBeUndefined();
  });
});
