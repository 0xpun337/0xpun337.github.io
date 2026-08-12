import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/[^_]*.mdx', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    deck: z.string(),
    series: z.string(),
    part: z.number().int().positive(),
    partsTotal: z.number().int().positive(),
    published: z.coerce.date(),
    readingMinutes: z.number().int().positive(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
