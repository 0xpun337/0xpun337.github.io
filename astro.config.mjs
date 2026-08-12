// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://0xpun337.github.io',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      // Emit CSS custom properties for both themes rather than baking one in;
      // base.css picks the right one. Without this the dark page renders a
      // light code block.
      defaultColor: false,
      wrap: false,
    },
  },
});
