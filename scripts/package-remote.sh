#!/bin/zsh
# Package Weft with the Flexbike signature, building on a Mac mini over the LAN.
#
#   scripts/package-remote.sh [--host m1mini|m2mini] [--no-sign] [--check]
#
# 1. Picks a builder (m1mini, then m2mini): reachable over SSH and 12 GB free. --host forces one.
# 2. rsyncs the working tree (no node_modules, builds or .git) to ~/dev/weft-build there.
# 3. On the mini: pnpm install, `next build` (standalone), prepare-standalone, bundle-toolchain.
# 4. rsyncs .next-dist and .toolchain-dist back, so the heavy work (the Next build) ran off this Mac.
# 5. Here: electron-builder packs, signs with the Flexbike Developer ID in this Mac's keychain
#    (the minis don't have the private key, so signing never leaves this Mac) and notarizes with the
#    notarytool keychain profile WEFT_NOTARY_PROFILE (default weft-notary; store it once with
#    scripts/store-notary-profile.sh), else with APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.
#    Output: dist/Weft-<version>-arm64.{dmg,zip}.
#
# --check does steps 1 and the signing identity lookup only. --no-sign stops after step 4 and packs unsigned.
set -eu
cd "${0:A:h}/.."

IDENTITY="${WEFT_SIGN_IDENTITY:-Flexbike, Inc. (H78XB55WG8)}"
NOTARY="${WEFT_NOTARY_PROFILE:-weft-notary}"
REMOTE_DIR="dev/weft-build"
# alias -> ssh target; m1mini comes from ~/.ssh/config, m2mini from the zprofile alias.
typeset -A TARGETS=(m1mini m1mini m2mini alexmiller@m2mini.local)
host=""; sign=1; check=0
while (( $# )); do
  case "$1" in
    --host) host="$2"; shift ;;
    --no-sign) sign=0 ;;
    --check) check=1 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

# usable <target>: reachable, and enough free disk for node_modules plus two builds
usable() {
  local free
  free=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$1" "df -g / | awk 'NR==2{print \$4}'" 2>/dev/null) || return 1
  [[ "$free" -ge 12 ]]
}

candidates=(m1mini m2mini)
[[ -n "$host" ]] && candidates=("$host")
target=""
for name in $candidates; do
  t="${TARGETS[$name]:-$name}"
  if usable "$t"; then target="$t"; echo "builder: $name ($t)"; break; fi
  echo "skip $name: unreachable or under 12 GB free"
done
[[ -n "$target" ]] || { echo "no builder available; run pnpm dist:release here instead" >&2; exit 1; }

if (( sign )); then
  security find-identity -v -p codesigning | grep -q "$IDENTITY" \
    || { echo "signing identity \"$IDENTITY\" not in this Mac's keychain" >&2; exit 1; }
  echo "signing as: $IDENTITY"
  # electron-builder notarizes when APPLE_KEYCHAIN_PROFILE is set; history proves the profile's key works.
  if xcrun notarytool history --keychain-profile "$NOTARY" >/dev/null 2>&1; then
    export APPLE_KEYCHAIN_PROFILE="$NOTARY"
    echo "notarizing with keychain profile: $NOTARY"
  fi
fi
(( check )) && { echo "check ok"; exit 0; }

echo "== sync source to $target:~/$REMOTE_DIR"
ssh "$target" "mkdir -p ~/$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude '.next*' --exclude dist --exclude .git \
  --exclude .toolchain-dist --exclude coverage --exclude .posthog \
  ./ "$target:$REMOTE_DIR/"

echo "== build on $target"
ssh "$target" "zsh -lic 'cd ~/$REMOTE_DIR && pnpm install --frozen-lockfile && WEFT_DIST=.next-dist WEFT_STANDALONE=1 pnpm exec next build && node scripts/prepare-standalone.mjs .next-dist && node scripts/bundle-toolchain.mjs'"

echo "== fetch build output"
rm -rf .next-dist .toolchain-dist
rsync -az "$target:$REMOTE_DIR/.next-dist" "$target:$REMOTE_DIR/.toolchain-dist" ./

echo "== pack here"
if (( sign )); then
  CSC_NAME="$IDENTITY" pnpm exec electron-builder --mac --publish never
else
  CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --publish never
fi

if (( sign )); then
  app="$(ls -d dist/mac-arm64/*.app)"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv "$app" 2>&1 | grep -E "Authority|TeamIdentifier"
  if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}${APPLE_API_KEY:-}" ]]; then
    xcrun stapler validate "$app"
  else
    echo "note: not notarized (no $NOTARY keychain profile, APPLE_API_* unset); Gatekeeper on another Mac will refuse it"
  fi
fi
ls -lh dist/Weft-*-arm64.dmg dist/Weft-*-arm64.zip
