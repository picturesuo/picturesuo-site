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
  draft: z.boolean().default(false),
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

export const collections = { writing, projects, art };
