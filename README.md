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
