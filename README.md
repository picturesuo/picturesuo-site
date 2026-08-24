# Picturesuo

The source for [picturesuo.com](https://picturesuo.com): writing, projects, ceramics, and field notes in portable Markdown.

## Local setup

```bash
npm install
npm run dev
```

Before publishing:

```bash
npm run format:check
npm run build
```

## Publish

1. Add or edit Markdown in `src/content/`.
2. Set `draft: true` while working.
3. Preview locally and check the Git diff for private information.
4. Change `draft` to `false`, commit, and push to `main`.
5. GitHub Actions deploys the static build.
6. Share a self-contained excerpt on X and link the canonical page.

Nothing in the private life-log repository is read during this build. A draft in this public repository is still publicly visible on GitHub, even when it is hidden from the website.

## Content types

- `writing`: essays, short notes, and field notes
- `projects`: technical and creative work
- `art`: finished work and process studies
- `now`: hand-edited current focus
- `progress`: selected public milestones only
- `archive`: generated from every published collection

## Analytics

The site supports Cloudflare Web Analytics without cookies. Set `PUBLIC_CF_WEB_ANALYTICS_TOKEN` in the deployment environment after creating a Cloudflare Web Analytics site. When the value is absent, no analytics script loads.

## Domain

The production domain is `picturesuo.com`; `www.picturesuo.com` should redirect to the apex. `public/CNAME` preserves the custom-domain setting for GitHub Pages deployments.

## Privacy boundary

- Never commit raw journal entries, private goals, raw notecard photos, credentials, or real-time location.
- Publish travel notes after leaving the location.
- AI-generated text must be reviewed before it enters this repository.

## What the password does

The site is encrypted at build time with [StatiCrypt](https://github.com/robinmoisson/staticrypt):
every page is AES-256 encrypted, and a visitor types the password to decrypt it
in their own browser. `scripts/lock-site.sh` runs after the Astro build and
fails the deploy if any page comes out unencrypted. The password lives in the
`SITE_PASSWORD` repository secret, never in the source. `.staticrypt-salt` is
committed on purpose — a salt is not a secret, and it has to stay the same
across builds or unlocking one page would not unlock the next.

**Be clear about what this is.** It is a gate on the pages, not access control:

- **Images, PDFs, CSS and JavaScript are not encrypted.** Anything under
  `/images/…` is still fetchable by direct URL.
- **This repository is public.** Every post is readable in plain text right here
  on GitHub, password or not. Making the repo private would fix that, but Pages
  on a private repository needs a paid GitHub plan.
- **The encrypted pages are public files.** Anyone can download one and attack
  the password offline, at whatever rate their hardware allows.

So it keeps the site out of search results and away from anyone casually
passing by. It is not protection for anything that would actually hurt to leak.
For real access control, put the site behind Cloudflare Access — free for up to
50 people, real per-person sign-in — which needs the domain's nameservers moved
to Cloudflare.

Feeds and sitemaps are deleted while the site is locked, since they would list
every title and summary straight past the password, and `robots.txt` asks
crawlers to stay out.
