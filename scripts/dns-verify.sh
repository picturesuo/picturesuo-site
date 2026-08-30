#!/usr/bin/env bash
# Check that picturesuo.com is actually up, actually locked, and actually
# encrypted. Exits non-zero if anything is wrong, so it can be run unattended.
set -uo pipefail

DOMAIN="${DOMAIN:-picturesuo.com}"
PAGES_IPS=(185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153)
fail=0
ok()   { printf '  ok    %s\n' "$1"; }
warn() { printf '  warn  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "── DNS"
got="$(dig +short "$DOMAIN" A | sort)"
[ -n "$got" ] || bad "$DOMAIN does not resolve"
for ip in "${PAGES_IPS[@]}"; do
  if echo "$got" | grep -q "^${ip}$"; then ok "A $ip"; else warn "A $ip missing (redundancy only)"; fi
done
stray="$(echo "$got" | grep -v -F -f <(printf '%s\n' "${PAGES_IPS[@]}") || true)"
[ -z "$stray" ] || bad "unexpected A record(s): $(echo "$stray" | tr '\n' ' ')"
if [ -n "$(dig +short "www.${DOMAIN}")" ]; then ok "www resolves"; else warn "www does not resolve (CNAME missing)"; fi

echo "── HTTPS"
code="$(curl -sI -m 25 "https://${DOMAIN}/" -o /dev/null -w '%{http_code}')"
[ "$code" = "200" ] && ok "https 200" || bad "https returned $code"
redirect="$(curl -sI -m 20 "http://${DOMAIN}/" | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')"
case "$redirect" in https://*) ok "http → https" ;; *) bad "http does not redirect to https (got '${redirect:-none}')" ;; esac
exp="$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [ -n "$exp" ]; then
  left=$(( ( $(date -j -f "%b %d %T %Y %Z" "$exp" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
  [ "$left" -gt 20 ] && ok "cert valid ${left}d" || bad "cert expires in ${left}d"
else
  bad "could not read certificate"
fi

echo "── the lock"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
for p in / /progress/ /writing/ /about/ /art/; do
  # Retry: a timed-out or empty response is a failed fetch, not an unlocked
  # page, and reporting it as "NOT encrypted" would be a false alarm.
  code=""; for attempt in 1 2 3; do
    code="$(curl -s -m 40 --compressed "https://${DOMAIN}${p}" -o "$tmp/page" -w '%{http_code}')"
    [ "$code" = "200" ] && [ -s "$tmp/page" ] && break
    sleep 3
  done
  if [ "$code" != "200" ] || [ ! -s "$tmp/page" ]; then
    bad "${p} could not be fetched (HTTP ${code:-none}) — check separately, this is not a lock failure"
  elif ! grep -aq staticrypt "$tmp/page"; then
    bad "${p} is NOT encrypted"
  elif grep -aqE 'Initial Intentions|not a score|A PUBLIC RECORD' "$tmp/page"; then
    bad "${p} leaks plaintext content"
  else
    ok "${p} encrypted ($(wc -c < "$tmp/page" | tr -d ' ') bytes)"
  fi
done
for f in /rss.xml /sitemap-index.xml /feed.xml; do
  c="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://${DOMAIN}${f}")"
  [ "$c" = "404" ] && ok "${f} absent" || bad "${f} is reachable (HTTP $c) — it would leak titles"
done
curl -s -m 15 "https://${DOMAIN}/robots.txt" | grep -q 'Disallow: /' \
  && ok "robots.txt disallows crawlers" || bad "robots.txt does not disallow"

echo
[ "$fail" -eq 0 ] && echo "all good" || echo "PROBLEMS FOUND"
exit "$fail"
