// Vite config for @alexs-atlas/globe.
//  - `vite build`: library mode → dist/index.js (ESM) + dist/style.css.
//    maplibre-gl and @alexs-atlas/borders stay external (peer / dependency).
//    Type declarations come from `tsc -p tsconfig.json` (see package.json).
//  - `vite` (dev): serves examples/ with the borders dataset mounted at
//    /data/alexs-atlas/ (packages/borders/data) and @alexs-atlas/borders
//    resolved from its TypeScript sources, so nothing needs building first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const dataDir = path.resolve(here, '../borders/data');

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

/** Serves packages/borders/data at /data/alexs-atlas/ (dev and preview servers). */
function alexsAtlasData(): Plugin {
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void): void => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = path.resolve(dataDir, `.${rel}`);
    if (!file.startsWith(dataDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', file.endsWith('manifest.json') ? 'no-cache' : 'public, max-age=31536000, immutable');
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: 'alexs-atlas-data',
    configureServer(server) {
      server.middlewares.use('/data/alexs-atlas', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data/alexs-atlas', handler);
    },
  };
}

export default defineConfig(({ command }) => ({
  root: here,
  plugins: [alexsAtlasData()],
  resolve:
    command === 'serve'
      ? { alias: [{ find: /^@alexs-atlas\/borders$/, replacement: path.resolve(here, '../borders/src/index.ts') }] }
      : {},
  server: {
    fs: { allow: [repoRoot] },
  },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    minify: false, // a library: consumers minify; readable stack traces meanwhile
    cssCodeSplit: true, // required for a CSS entry; index.ts imports no CSS, so style.css is the only CSS output
    // Two entries: the JS API (src/index.ts imports no CSS, so its .d.ts stays
    // clean and importing it touches no DOM) and the stylesheet, which consumers
    // import explicitly as '@alexs-atlas/globe/style.css'.
    lib: {
      entry: { index: path.resolve(here, 'src/index.ts'), style: path.resolve(here, 'src/style.css') },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'style',
    },
    rolldownOptions: {
      external: [/^maplibre-gl(\/.*)?$/, /^@alexs-atlas\/borders(\/.*)?$/],
    },
  },
}));
