#!/usr/bin/env bash
# Add the DNS records picturesuo.com needs, through the Spaceship API.
#
# The site already works on a single A record. This adds the other three
# GitHub Pages addresses (redundancy if one edge node fails) and a www CNAME.
#
#   export SPACESHIP_API_KEY=...  SPACESHIP_API_SECRET=...
#   ./scripts/dns-apply.sh            # dry run: shows current vs wanted
#   ./scripts/dns-apply.sh --apply    # writes the missing records
#
# The API upserts the records you send and leaves everything else alone, so
# this cannot wipe the zone. The conflict checker stays on ("force": false).
set -euo pipefail

DOMAIN="${DOMAIN:-picturesuo.com}"
API="https://spaceship.dev/api/v1"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

: "${SPACESHIP_API_KEY:?set SPACESHIP_API_KEY (Spaceship → profile → API manager)}"
: "${SPACESHIP_API_SECRET:?set SPACESHIP_API_SECRET}"

auth=(-H "X-API-Key: ${SPACESHIP_API_KEY}" -H "X-API-Secret: ${SPACESHIP_API_SECRET}")

echo "── current records for ${DOMAIN}"
current="$(curl -sS "${auth[@]}" "${API}/dns/records/${DOMAIN}?take=500&skip=0")"
if ! echo "$current" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  echo "API did not return JSON — check the key and secret:"; echo "$current" | head -5; exit 1
fi
echo "$current" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for r in d.get("items",[]):
    v=r.get("address") or r.get("target") or r.get("value") or ""
    print(f"   {r.get(\"type\",\"?\"):6} {r.get(\"name\",\"?\"):6} {v}")
print(f"   ({d.get(\"total\",0)} total)")
'

read -r -d '' BODY <<'JSON' || true
{
  "force": false,
  "items": [
    { "type": "A",     "name": "@",   "ttl": 3600, "address": "185.199.108.153" },
    { "type": "A",     "name": "@",   "ttl": 3600, "address": "185.199.109.153" },
    { "type": "A",     "name": "@",   "ttl": 3600, "address": "185.199.110.153" },
    { "type": "A",     "name": "@",   "ttl": 3600, "address": "185.199.111.153" },
    { "type": "CNAME", "name": "www", "ttl": 3600, "target": "picturesuo.github.io" }
  ]
}
JSON

echo
echo "── wanted"
echo "$BODY" | python3 -c '
import json,sys
for r in json.load(sys.stdin)["items"]:
    print(f"   {r[\"type\"]:6} {r[\"name\"]:6} {r.get(\"address\") or r.get(\"target\")}")
'

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "dry run — nothing sent. Re-run with --apply to write these."
  exit 0
fi

echo
echo "── applying"
code="$(curl -sS -o /tmp/spaceship-dns.out -w '%{http_code}' -X PUT "${auth[@]}" \
  -H 'Content-Type: application/json' -d "$BODY" "${API}/dns/records/${DOMAIN}")"

if [ "$code" = "204" ] || [ "$code" = "200" ]; then
  echo "accepted (HTTP $code). DNS usually settles in a few minutes."
  echo "verify with: ./scripts/dns-verify.sh"
else
  echo "FAILED (HTTP $code):"; cat /tmp/spaceship-dns.out; exit 1
fi
