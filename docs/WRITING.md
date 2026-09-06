# How writing works here

Three cadences, three shapes. Nothing here publishes on its own.

## 1. Daily — the card

The 3×5 card. Front is what you planned, back is what actually happened. It
stays private: only five counts and an anti-goal flag ever reach the public
calendar at `/progress/`, through `counts:export` in the life-log repo. The card
text itself never leaves that repository.

## 2. Weekly — the week note

Short, dated, published whether or not the week went well. A weak one is
allowed; skipping is not.

## 3. Long — articles, and the threads that grow them

An article is a spine: what you think today, stated once. It does not have to be
finished, because you can come back to it.

### Writing an article

`src/content/writing/building-an-alter-ego.md`

```yaml
---
title: 'Building an Alter Ego'
summary: 'One sentence, shown in listings.'
publishedAt: 2026-09-01
kind: essay          # essay | note | field-note
tags: [identity]     # up to three
draft: true          # true = excluded from the build entirely
---
```

`draft: true` is the private mode: write in the open, publish when it is done by
flipping it to `false`. A draft is not built, not linked, and not deployed.

### Continuing it

Months later, do not rewrite the spine. Add a continuation:

`src/content/threads/building-an-alter-ego--2026-10-04.md`

```yaml
---
parent: building-an-alter-ego   # the article's slug
addedAt: 2026-10-04
title: 'The part I got wrong'   # optional
draft: false
---

The new instalment.
```

It renders beneath the article under a dated rule — *Continued · Oct 4, 2026* —
with its own anchor link, and the article's header starts reporting how many
continuations exist and when the last one landed. Continuations read forward in
time, oldest first, so the page shows the thinking changing.

Naming the file `<parent-slug>--<date>.md` keeps the folder sorted and readable.
Only `parent` actually matters.

### Editing something already published

Sometimes a sentence is simply wrong. Change it, and record that you did:

```yaml
edits:
  - date: 2026-10-11
    note: corrected the claim about the second kiln firing
```

That renders as *Edited since publishing* at the foot of the piece. The words
may change; the fact that they changed does not disappear. This is the whole
difference between a thread and a quiet rewrite.

## 4. Books

`src/content/reading/<slug>.md` — what you read and what you thought of it.
The bookshelf in the studio reads from this collection, so a book with no note
is a book with nothing to open.

```yaml
---
title: 'Show Your Work!'
author: 'Austin Kleon'
finishedAt: 2023-08-19
status: finished        # reading | finished | abandoned
rating: 5               # optional, 1–5
summary: 'One line: what it did to you.'
draft: false
---

The longer thought.
```
