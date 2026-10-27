# Sourced by puku-cli before each Bash command of a Weft thread (PUKU_CLI_ENV_FILE, lib/puku-dotenv.ts).
# Weft starts puku-cli with its Puku sign-in variables set to blank, so Bun won't load a project's own key from
# its .env as puku-cli's login. Here they're unset again, so the project's tools and dev server read its .env.
for weft_name in PUKU_AI_API_KEY PUKU_API_KEY PUKU_AUTH_TOKEN PUKU_CLI_OAUTH_TOKEN PUKU_AI_BASE_URL PUKU_BASE_URL; do
  eval "weft_value=\${$weft_name-unset}"
  [ -z "$weft_value" ] && unset "$weft_name"
done
unset weft_name weft_value
# Your own PUKU_CLI_ENV_FILE, if you had one, still runs.
if [ -n "${WEFT_PUKU_ENV_FILE-}" ]; then . "$WEFT_PUKU_ENV_FILE"; fi
