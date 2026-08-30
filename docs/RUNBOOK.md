# Runbook

Everything that still needs human hands, and everything that does not.

## The two things only you can do

### 1. Paste the daily card into ChatGPT (2 minutes)

The prompt is written and committed in the private repo at
`chatgpt-automation.md`. It cannot be installed for you — it needs a login to
your ChatGPT account.

1. ChatGPT app → sidebar → **Automations** → **New automation**
2. Schedule: **every day, 8:00 am**. Name: **Daily card**
3. Paste the prompt from `picturesuo-life-log/chatgpt-automation.md`
4. Save

A local task already does the same thing at 08:04 without the app. Run both and
you get asked twice — pick one.

### 2. DNS redundancy (5 minutes, optional)

The site works today on a single A record. Three more addresses and a `www`
alias mean it keeps working if one GitHub edge node has a bad day.

**Fastest path — by hand.** Spaceship → Launchpad → picturesuo.com →
Advanced DNS → DNS records → Add record, five times:

| Type  | Host | Value                  |
|-------|------|------------------------|
| A     | @    | 185.199.109.153        |
| A     | @    | 185.199.110.153        |
| A     | @    | 185.199.111.153        |
| CNAME | www  | picturesuo.github.io   |

Leave the existing `185.199.108.153` alone. Then run `./scripts/dns-verify.sh`.

**Scripted path — if you would rather not click.** Mint an API key at
Spaceship → your profile → **API manager** → *Create API key* (allow your
current IP), then:

```bash
export SPACESHIP_API_KEY=...
export SPACESHIP_API_SECRET=...
./scripts/dns-apply.sh            # dry run — shows current vs wanted
./scripts/dns-apply.sh --apply    # writes the missing records
./scripts/dns-verify.sh           # confirms
```

The API upserts only the records it is given, so it cannot wipe the zone, and
the conflict checker is left on.

## Checking the site is healthy

```bash
./scripts/dns-verify.sh
```

Checks DNS, HTTPS, certificate expiry, that every page is still encrypted, that
no page leaks plaintext, that the feeds and sitemaps are gone, and that
robots.txt still blocks crawlers. Exits non-zero on a real problem, so it can
run unattended. A failed fetch is reported as a failed fetch, not as an unlocked
page.

## Changing the password

```bash
gh secret set SITE_PASSWORD --repo picturesuo/picturesuo-site
```

Then push anything, or re-run the deploy workflow. Do not change
`.staticrypt-salt` — it is committed on purpose, and changing it locks out every
visitor who has already unlocked the site.

## Taking the password off

Delete the "Lock the site behind the password" step from
`.github/workflows/deploy.yml` and push. Remember to put back `rss.xml` and the
sitemap by removing the deletion lines in `scripts/lock-site.sh`, and to restore
a normal `robots.txt`.

## What the password is not

This repository is public: every post is readable on GitHub whatever the site
does. Images and PDFs are not encrypted and stay fetchable by direct URL. The
encrypted pages are public files and can be attacked offline. It keeps the site
out of search results and away from passers-by; it is not protection for
anything that would hurt to leak. For real access control, put the site behind
Cloudflare Access — free for up to 50 people — which needs the domain's
nameservers moved to Cloudflare.
