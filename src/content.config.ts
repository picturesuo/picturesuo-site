import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const shared = {
  title: z.string(),
  summary: z.string(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  tags: z.array(z.string()).max(3).default([]),
  featured: z.boolean().default(false),
  // draft: true keeps a piece out of the build entirely — write it in the open,
  // publish it when it is finished.
  draft: z.boolean().default(false),
  // A revision to something already published. The text changes, but the fact
  // that it changed is kept and shown, so the record stays honest.
  edits: z
    .array(z.object({ date: z.coerce.date(), note: z.string() }))
    .default([]),
};

const writing = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/writing' }),
  schema: z.object({
    ...shared,
    kind: z.enum(['essay', 'note', 'field-note']).default('essay'),
    originalUrl: z.url().optional(),
    place: z.string().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    ...shared,
    status: z.enum(['active', 'shipped', 'archived']),
    language: z.string().optional(),
    repoUrl: z.url().optional(),
    demoUrl: z.url().optional(),
  }),
});

const art = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/art' }),
  schema: z.object({
    ...shared,
    year: z.number(),
    medium: z.string(),
    dimensions: z.string().optional(),
    image: z.string(),
    imageAlt: z.string(),
  }),
});

// A thread is a dated continuation of an existing piece of writing. The spine
// keeps its original words; continuations stack underneath it, newest last, so
// an essay visibly grows over months instead of being quietly rewritten.
const threads = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/threads' }),
  schema: z.object({
    // slug of the entry in `writing` this continues
    parent: z.string(),
    addedAt: z.coerce.date(),
    // optional heading for this instalment; omit for an unbroken continuation
    title: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

// Books, with what Ben actually thought of them — the shelf in the studio reads
// from this.
const reading = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/reading' }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    finishedAt: z.coerce.date().optional(),
    status: z.enum(['reading', 'finished', 'abandoned']).default('finished'),
    rating: z.number().min(1).max(5).optional(),
    summary: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, projects, art, threads, reading };
