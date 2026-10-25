// Where a secret's value comes from, by its name: the hint a 🔐 blank shows (docs/architecture/secrets.md), with
// the direct link that opens in the browser pane. Used by the project intake (lib/project-intake.ts) for the names
// it finds in a project's code and .env.example, so a blank says where to get it without a thread writing the hint.

type Hint = { test: RegExp; hint: string };

// First match wins, so a specific name (a webhook's signing secret) sits above its provider's catch-all.
const HINTS: Hint[] = [
  { test: /^STRIPE_WEBHOOK_SECRET$/, hint: "Stripe → Developers → Webhooks → your endpoint's signing secret: https://dashboard.stripe.com/webhooks" },
  { test: /^RESEND_WEBHOOK/, hint: "Resend → Webhooks → your endpoint's signing secret: https://resend.com/webhooks" },
  { test: /^CLERK_WEBHOOK/, hint: "Clerk → Configure → Webhooks → your endpoint's signing secret: https://dashboard.clerk.com/last-active?path=webhooks" },
  { test: /^GITHUB_WEBHOOK/, hint: "The secret you typed into the repo's Settings → Webhooks (make one up with 🎲)" },
  { test: /STRIPE/, hint: "Stripe → Developers → API keys: https://dashboard.stripe.com/apikeys" },
  { test: /SUPABASE/, hint: "Supabase → Project Settings → API keys: https://supabase.com/dashboard/project/_/settings/api-keys" },
  { test: /^DATABASE_URL$|^POSTGRES_URL|^DIRECT_URL$/, hint: "Your database's connection string; on Supabase it's under Connect: https://supabase.com/dashboard/project/_/?showConnect=true" },
  { test: /ANTHROPIC|CLAUDE/, hint: "Anthropic Console → API keys: https://console.anthropic.com/settings/keys" },
  { test: /OPENAI/, hint: "OpenAI → API keys: https://platform.openai.com/api-keys" },
  { test: /GEMINI|GOOGLE_AI|GOOGLE_GENERATIVE/, hint: "Google AI Studio → API keys: https://aistudio.google.com/apikey" },
  { test: /RESEND/, hint: "Resend → API keys: https://resend.com/api-keys" },
  { test: /CLERK/, hint: "Clerk → Configure → API keys: https://dashboard.clerk.com/last-active?path=api-keys" },
  { test: /GITHUB.*(CLIENT|OAUTH)/, hint: "GitHub → Settings → Developer settings → OAuth Apps: https://github.com/settings/developers" },
  { test: /GITHUB|GH_TOKEN/, hint: "GitHub → Settings → Personal access tokens: https://github.com/settings/tokens" },
  { test: /GOOGLE/, hint: "Google Cloud → APIs & Services → Credentials: https://console.cloud.google.com/apis/credentials" },
  { test: /POSTHOG/, hint: "PostHog → Project settings → Project API key: https://us.posthog.com/settings/project" },
  { test: /SENTRY/, hint: "Sentry → Settings → Auth tokens: https://sentry.io/settings/account/api/auth-tokens/" },
  { test: /^VERCEL.*(TOKEN|KEY)/, hint: "Vercel → Account Settings → Tokens: https://vercel.com/account/tokens" },
  { test: /CLOUDFLARE|^CF_/, hint: "Cloudflare → My Profile → API Tokens: https://dash.cloudflare.com/profile/api-tokens" },
  { test: /UPSTASH|^KV_|REDIS/, hint: "Upstash → your database → REST API: https://console.upstash.com" },
  { test: /TWILIO/, hint: "Twilio Console → Account info: https://console.twilio.com" },
  { test: /SENDGRID/, hint: "SendGrid → Settings → API Keys: https://app.sendgrid.com/settings/api_keys" },
  { test: /ELEVENLABS/, hint: "ElevenLabs → Settings → API keys: https://elevenlabs.io/app/settings/api-keys" },
  { test: /REPLICATE/, hint: "Replicate → Account → API tokens: https://replicate.com/account/api-tokens" },
  { test: /SLACK/, hint: "Slack → Your apps → your app's credentials: https://api.slack.com/apps" },
  { test: /^AWS_/, hint: "AWS → IAM → Security credentials: https://console.aws.amazon.com/iam/home#/security_credentials" },
];

// The hint for a name, or undefined when it's no provider Weft knows.
export function providerHint(name: string): string | undefined {
  return HINTS.find((h) => h.test.test(name))?.hint;
}
