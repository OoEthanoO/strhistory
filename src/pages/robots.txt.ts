/**
 * /robots.txt — lets search engines crawl everything and points them at the
 * sitemap that @astrojs/sitemap writes at build time. Built from `site` in
 * astro.config.mjs, so the sitemap URL follows SITE_URL.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) =>
  new Response(
    ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site)}`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
