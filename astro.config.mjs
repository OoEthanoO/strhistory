// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// The site is fully static: `astro build` writes plain files to dist/, and the
// home server's Caddy serves them. See AGENTS.md → "Deployment".
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://history.ethanyanxu.com',
  output: 'static',
  trailingSlash: 'ignore',
  // Astro 7 defaults to JSX-style whitespace stripping, which glues together
  // inline elements in prose ("<em>a</em> <strong>b</strong>" → "ab"). Notes are
  // prose-heavy, so keep HTML-aware whitespace handling.
  compressHTML: true,
  integrations: [mdx(), react()],
  vite: {
    build: {
      // MapLibre is large (~1 MB); the home and explorer islands import it lazily.
      chunkSizeWarningLimit: 1600,
      rolldownOptions: {
        // Astro's MDX pipeline emits one harmless MODULE_LEVEL_DIRECTIVE warning
        // per .mdx file; hiding them keeps real problems visible in deploy logs.
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        },
      },
    },
    // MapLibre starts its web worker as an ES module worker.
    worker: { format: 'es' },
  },
});
