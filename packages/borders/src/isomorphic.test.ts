// Guards the package contract: the main entry is isomorphic ESM with no DOM access,
// no Node built-ins, no MapLibre import and only topojson-client as a dependency.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const runtimeFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && f !== 'node.ts');

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('isomorphic main entry', () => {
  it('has runtime modules to check', () => {
    expect(runtimeFiles).toContain('index.ts');
    expect(runtimeFiles).toContain('client.ts');
  });

  it.each(runtimeFiles)('%s imports only relative modules and topojson-client', (file) => {
    const code = strip(readFileSync(join(SRC, file), 'utf8'));
    const specifiers = [...code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specifiers) expect(s === 'topojson-client' || s?.startsWith('./')).toBe(true);
    expect(code).not.toMatch(/\bimport\s*\(/); // no dynamic imports
  });

  it.each(runtimeFiles)('%s touches no DOM or Node-only globals', (file) => {
    const code = strip(readFileSync(join(SRC, file), 'utf8'));
    expect(code).not.toMatch(/\b(window|document|navigator|localStorage|sessionStorage|XMLHttpRequest|HTMLElement)\b/);
    expect(code).not.toMatch(/\b(process|Buffer|require|__dirname|__filename)\b/);
    expect(code).not.toMatch(/maplibre/i);
  });

  it('the index does not re-export the Node helper', () => {
    expect(readFileSync(join(SRC, 'index.ts'), 'utf8')).not.toMatch(/node\.js/);
  });
});
