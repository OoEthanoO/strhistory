// Vite config for the standalone timeline demo (src/timeline/demo.html):
//
//   npx vite --config packages/globe/src/timeline/demo.vite.config.mjs
//   → http://localhost:<free port>/demo.html (Vite prints the URL; ?layout=bar for the bar)
//
// Serves this folder only. @alexs-atlas/borders resolves to its TypeScript sources
// (nothing needs building first), and the built dataset folder (packages/borders/data),
// when present, is the public dir, so the demo reads the real border-change years from
// /manifest.json. Plain .mjs so the package's TypeScript build never picks it up.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const bordersSrc = path.join(repoRoot, 'packages/borders/src/index.ts');
const dataDir = path.join(repoRoot, 'packages/borders/data');

export default {
  root: here,
  publicDir: existsSync(path.join(dataDir, 'manifest.json')) ? dataDir : false,
  resolve: {
    alias: existsSync(bordersSrc) ? [{ find: /^@alexs-atlas\/borders$/, replacement: bordersSrc }] : [],
  },
  server: {
    // A free port chosen by the OS, so the demo never competes with a dev server already
    // running (the site's use 5180 and up).
    port: 0,
    fs: { allow: [repoRoot] },
  },
  build: { outDir: path.join(repoRoot, '.cache/timeline-demo'), emptyOutDir: true, rollupOptions: { input: path.join(here, 'demo.html') } },
};
