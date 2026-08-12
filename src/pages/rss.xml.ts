import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => +b.data.published - +a.data.published,
  );

  return rss({
    title: '0xpun337 — systems engineering notes',
    description:
      'Systems engineering — Rust, C++, reverse engineering, and the layers underneath.',
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.deck,
      pubDate: p.data.published,
      link: `/writing/${p.id}/`,
    })),
  });
}
