#!/usr/bin/env bash
# Password-gate the built site.
#
# StatiCrypt encrypts each page with AES-256 and a PBKDF2-stretched key; the
# visitor types the password and the page decrypts in their own browser.
#
# What this covers: the text of every page. What it does NOT cover: images,
# PDFs, CSS and JS, which stay fetchable by direct URL — and the source repo, if
# it is public. See "What the password does" in README.md before trusting it.
set -euo pipefail

: "${SITE_PASSWORD:?SITE_PASSWORD is not set — refusing to publish an unlocked site}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
test -d dist || { echo "dist/ not found — run npm run build first"; exit 1; }

# One salt for the whole site, generated once and committed. A salt is not a
# secret; what it must be is *stable*, so a returning visitor stays unlocked.
if [ ! -f "$ROOT/.staticrypt-salt" ]; then
  head -c 16 /dev/urandom | xxd -p | tr -d '\n' > "$ROOT/.staticrypt-salt"
  echo "generated a new salt at .staticrypt-salt — commit it"
fi
SALT="$(cat "$ROOT/.staticrypt-salt")"

cd dist

# StatiCrypt writes output by basename, so a whole tree of index.html files
# collapses onto one. Encrypt each page in place instead, one at a time.
#
# Every page must share one salt (kept in .staticrypt.json, committed — a salt
# is not a secret). With a salt per page, the passphrase stored after unlocking
# one page does not match the next, and the visitor is asked again on every
# single page.
count=0
while IFS= read -r page; do
  npx --no-install staticrypt "$page" \
    -p "$SITE_PASSWORD" \
    -d "$(dirname "$page")" \
    -c false \
    -s "$SALT" \
    --short \
    --remember 30 \
    --template-title "picturesuo.com" \
    --template-instructions "This site is private while it is being built." \
    --template-button "Enter" \
    --template-placeholder "Password" \
    --template-error "That is not it." \
    --template-remember "Stay unlocked on this device" \
    --template-color-primary "#39795a" \
    --template-color-secondary "#f3f0e8" >/dev/null

  # Default "remember me" to on. Without it the password is asked for again on
  # every single page, which makes the site unusable rather than private.
  perl -pi -e 's/(<input id="staticrypt-remember" type="checkbox" name="remember")\s*\/>/$1 checked \/>/' "$page"
  count=$((count + 1))
done < <(find . -name '*.html')

# Feeds and sitemaps are plain XML: they would hand out every title and summary
# straight past the password. Remove them while the site is locked.
find . \( -name 'rss.xml' -o -name 'feed.xml' -o -name 'sitemap*.xml' \) -delete

# And ask crawlers to stay out.
printf 'User-agent: *\nDisallow: /\n' > robots.txt

total=$(find . -name '*.html' | wc -l | tr -d ' ')
locked=$(grep -rl staticrypt . --include='*.html' | wc -l | tr -d ' ')
echo "locked ${locked}/${total} pages (processed ${count})"
if [ "$total" != "$locked" ]; then
  echo "ERROR: ${total} pages built but only ${locked} encrypted — refusing to deploy"
  exit 1
fi
