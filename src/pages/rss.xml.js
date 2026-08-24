import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const writing = await getCollection('writing', ({ data }) => !data.draft);
  return rss({
    title: 'Picturesuo',
    description: 'Writing, projects, and objects from Picturesuo.',
    site: context.site,
    items: writing
      .toSorted((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
      .map((entry) => ({
        title: entry.data.title,
        description: entry.data.summary,
        pubDate: entry.data.publishedAt,
        link: `/writing/${entry.id}/`,
      })),
  });
}
