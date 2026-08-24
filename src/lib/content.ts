import type { CollectionEntry } from 'astro:content';

export type PublicEntry =
  CollectionEntry<'writing'> | CollectionEntry<'projects'> | CollectionEntry<'art'>;

export function newestFirst<T extends PublicEntry>(entries: T[]): T[] {
  return entries.toSorted((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function entryHref(entry: PublicEntry): string {
  if (entry.collection === 'writing') return `/writing/${entry.id}`;
  if (entry.collection === 'projects') return `/projects/${entry.id}`;
  return `/art/${entry.id}`;
}
