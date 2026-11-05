#!/bin/zsh
# Store Weft's notarization key as a notarytool keychain profile, so package-remote.sh can notarize.
#
#   scripts/store-notary-profile.sh [env-file]   (default ~/dev/flexbike/flexbike-react-native/.env)
#
# Reads ASC_KEY_ID, ASC_ISSUER_ID and ASC_API_KEY_BASE64 (or ASC_KEY_PATH) from the env file, the
# App Store Connect API key Flexbike's TestFlight poller uses, and runs `xcrun notarytool
# store-credentials`, which checks the key with Apple and saves it in the login keychain.
# Run it yourself in a terminal: the values never print and never reach a thread.
set -eu
env_file="${1:-$HOME/dev/flexbike/flexbike-react-native/.env}"
profile="${WEFT_NOTARY_PROFILE:-weft-notary}"
[[ -f "$env_file" ]] || { echo "no $env_file" >&2; exit 1; }
set -a; source "$env_file"; set +a
: "${ASC_KEY_ID:?ASC_KEY_ID missing from $env_file}" "${ASC_ISSUER_ID:?ASC_ISSUER_ID missing from $env_file}"

key="${ASC_KEY_PATH:-}"
if [[ -z "$key" ]]; then
  : "${ASC_API_KEY_BASE64:?neither ASC_API_KEY_BASE64 nor ASC_KEY_PATH in $env_file}"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  key="$tmp/AuthKey_$ASC_KEY_ID.p8"
  print -rn -- "$ASC_API_KEY_BASE64" | base64 -D > "$key"
  chmod 600 "$key"
fi

xcrun notarytool store-credentials "$profile" --key "$key" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID"
echo "stored keychain profile $profile; scripts/package-remote.sh will notarize with it"
