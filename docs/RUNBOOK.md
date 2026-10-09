# Runbook

Everything that still needs human hands, and everything that does not.

## The things only you can do

### 0. Put a GitHub token on your phone for the check-in (5 minutes, once per phone)

[picturesuo.com/today/](https://picturesuo.com/today/) is the daily check-in:
five counts, one tick, one optional private line, Save. It commits straight
to GitHub from the phone, so the phone needs a token. One token, two
repositories, nothing else.

1. GitHub → profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Token name:** `phone check-in`. **Expiration:** 90 days is a good habit.
   When it runs out the page says "GitHub rejected the token" and you paste a
   new one in the same place.
3. **Resource owner:** picturesuo. **Repository access:** *Only select
   repositories* → pick `picturesuo-site` and `picturesuo-life-log`. Nothing
   else.
4. **Permissions** → **Repository permissions** → **Contents** → *Read and
   write*. Leave every other permission at *No access*; Metadata is added by
   GitHub automatically and is read-only.
5. **Generate token**, copy it.
6. On the phone, open picturesuo.com/today/, enter the site password, scroll to
   **Device setup**, paste the token, tap **Check and save on this device**.
   The page reads both repositories to prove the token works before it keeps
   it, and refuses if the life-log is not private.

Then the morning is: open the page, tap, Save. Counts go to
`src/data/log.json` in this repo (one commit, that one file); the counts plus
the line go to `checkins/YYYY-MM-DD.md` in the private repo (one commit, that
one file). The calendar at `/progress/` picks the day up on the next deploy,
which the commit itself triggers. A skipped day is never filled in with zeros:
the page only writes the day you are looking at when you tap Save. Saving five
zeros on purpose is allowed and records a zero day. Saving a day again
replaces its counts and keeps the line you already wrote unless you type a
new one.

**What the token can and cannot do.** It is stored in the phone browser's
localStorage for picturesuo.com, in the clear. The site password gates the
page that reads it, and nothing else does, but anyone holding the unlocked
phone can use the page, and any script running on picturesuo.com (today that
is the site's own code and, if enabled, Cloudflare's analytics script) could
read it. It can read and write file contents in those two repositories and
nothing else: no settings, no secrets, no other repository, no account.

- **Lost or shared phone:** GitHub → the same *Fine-grained tokens* page →
  **Delete** next to `phone check-in`. That kills it everywhere at once.
- **Removing it from a phone you still have:** **Device setup** → **Forget
  token**. (Or clear site data for picturesuo.com.)
- **Expired:** the page says "GitHub rejected the token"; generate a new one
  and paste it in the same place. The old one is already dead.

### 0b. Register the evening nudge (2 minutes, once)

The 8am task (`~/.claude/scheduled-tasks/picturesuo-daily-heartbeat/`) now
opens the check-in page and says whether yesterday is logged, instead of
running the card in chat. A second task, `picturesuo-evening-nudge`, pushes
one reminder at 21:00 if today is still not logged. Both definitions are
versioned in the private repo under `automation/`. Until `/today/` is live the
8am task checks for the page first and runs the old card ritual instead.

To install the evening one: copy
`picturesuo-life-log/automation/picturesuo-evening-nudge/` into
`~/.claude/scheduled-tasks/`, then in the Claude app's scheduled tasks add it
at **21:00 daily**. The push reaches the phone only while Remote Control is
connected to that session; otherwise it is a desktop notification.

### 1. Paste the daily card into ChatGPT (2 minutes)

The prompt is written and committed in the private repo at
`chatgpt-automation.md`. It cannot be installed for you — it needs a login to
your ChatGPT account.

1. ChatGPT app → sidebar → **Automations** → **New automation**
2. Schedule: **every day, 8:00 am**. Name: **Daily card**
3. Paste the prompt from `picturesuo-life-log/chatgpt-automation.md`
4. Save

Until `/today/` is live, a local task does the same thing at 08:04 without the
app; run both and you get asked twice, so pick one. Once the page is live that
task opens the check-in instead (see 0b).

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
