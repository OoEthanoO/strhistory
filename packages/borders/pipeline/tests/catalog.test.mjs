// tools/catalog.mjs: generated override catalog between the markers in AGENTS.md.
import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { START, END, buildCatalog, buildSummary, catalogDocument, loadOverrides, replaceSection, fmtYears, cell, describeGeometry } from '../tools/catalog.mjs';
import { BORDERS } from '../steps/lib/context.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const overridesDir = join(fixtures, 'overrides');
const cli = fileURLToPath(new URL('../tools/catalog.mjs', import.meta.url));

describe('catalog markers', () => {
  it('appear exactly once, in order, in packages/borders/AGENTS.md', () => {
    const doc = readFileSync(join(BORDERS, 'AGENTS.md'), 'utf8');
    expect(doc.split(START).length - 1).toBe(1);
    expect(doc.split(END).length - 1).toBe(1);
    expect(doc.indexOf(START)).toBeLessThan(doc.indexOf(END));
  });

  it('replaceSection swaps only the text between the markers (and keeps CRLF files CRLF)', () => {
    const doc = 'a\nb\n' + START + '\nold\n' + END + '\nc\n';
    const out = replaceSection(doc, 'new 1\nnew 2');
    expect(out).toBe('a\nb\n' + START + '\nnew 1\nnew 2\n' + END + '\nc\n');
    const crlf = doc.replace(/\n/g, '\r\n');
    expect(replaceSection(crlf, 'x\ny')).toBe('a\r\nb\r\n' + START + '\r\nx\r\ny\r\n' + END + '\r\nc\r\n');
    expect(() => replaceSection('no markers here', 'x')).toThrow(/markers/);
  });
});

describe('catalog content', () => {
  const { files, errors } = loadOverrides(overridesDir);
  const md = buildCatalog(files);

  it('loads the fixture files sorted by kind and path', () => {
    expect(errors).toEqual([]);
    expect(files.map((f) => f.rel)).toEqual(['historical/test-region.json', 'modern/test-group.json']);
  });

  it('is deterministic', () => {
    expect(buildCatalog(loadOverrides(overridesDir).files)).toBe(md);
  });

  it('summarises entries per file × op × status', () => {
    expect(md).toContain('| historical/test-region.json | add | 1 |  |  |  | 1 |');
    expect(md).toContain('| historical/test-region.json | update |  | 1 |  |  | 1 |');
    expect(md).toContain('| historical/test-region.json | delete |  |  |  | 1 | 1 |');
    expect(md).toContain('| historical/test-region.json | note |  |  | 1 |  | 1 |');
    expect(md).toContain('| modern/test-group.json | units |');
    expect(md).toContain('| **all files** | entries | **3** | **1** | **1** | **1** | **6** |');
  });

  it('lists entries with polity/target, years, escaped reason, numbered sources, confidence and status', () => {
    const row = md.split('\n').find((l) => l.startsWith('| `h-test-region-0001`'));
    expect(row).toContain('**Cherokee Nation** `ovr:cherokee-nation` (indigenous, tier 1, approximate) — polygon (4 vertices)');
    expect(row).toContain('| 1794–1838 |');
    expect(row).toContain('a \\| pipe and a newline');
    expect(row).toContain('[1](https://www.loc.gov/item/13023487/)');
    expect(row).toMatch(/\| medium \| active \|$/);
    // a source cited twice keeps its number; the list is written once per file
    const update = md.split('\n').find((l) => l.startsWith('| `h-test-region-0002`'));
    expect(update).toContain('`clio:new-france` set name → New France; kind → dependency');
    expect(update).toContain('[1](https://www.loc.gov/item/13023487/) [2](https://en.wikipedia.org/wiki/New_France)');
    expect(md).toContain('1. [Royce, Indian Land Cessions in the United States (1899)](https://www.loc.gov/item/13023487/)');
    expect(md.split('\n').find((l) => l.startsWith('| `h-test-region-0003`'))).toContain('— islands Jersey');
  });

  it('lists modern units one row per unit with periods and subunits, and overlays', () => {
    const deu = md.split('\n').find((l) => l.startsWith('| `DEU`'));
    expect(deu).toContain('1990–present → Germany `ne:deu`');
    expect(deu).toContain('`west-germany` West German Länder [admin-1 DE-BW, DE-BY, DE-HB, DE-HH, DE-HE, DE-NI +3]: 1946–1948 → Allied-occupied Germany `ovr:allied-occupied-germany` (dependency); 1949–1989 → West Germany `ovr:west-germany`');
    expect(md.split('\n').find((l) => l.startsWith('| `ATA`'))).toContain('1946–present → unclaimed');
    const crimea = md.split('\n').find((l) => l.startsWith('| `m-test-group-crimea`'));
    expect(crimea).toContain('NE disputed B20');
    expect(crimea).toContain('2014–present → **Crimea** disputed controlled by ne:rus claimed by ne:ukr');
  });

  it('lists known gaps separately', () => {
    const gaps = md.slice(md.indexOf('### Known gaps'));
    expect(gaps).toContain('`h-test-region-0004`');
    expect(gaps).toContain('Fixture: a known gap that cannot be drawn yet.');
    const fileSection = md.slice(md.indexOf('### historical/test-region.json'), md.indexOf('### modern/test-group.json'));
    expect(fileSection).not.toContain('| `h-test-region-0004`');
    expect(fileSection).toContain('1 known gap(s) of this file are listed under [Known gaps](#known-gaps).');
  });

  it('lists only the active entries of machine-generated (auto-*.json) files', () => {
    const entry = (id, op, status) => ({ id, op, status, years: [1800, 1810], reason: `reason ${id}`, sources: [{ title: 't', url: 'https://example.org/' }],
      ...(op === 'update' ? { target: { pid: 'clio:a' }, set: { name: 'A' } } : {}) });
    const file = { rel: 'historical/auto-wikidata.json', data: { kind: 'historical', region: 'auto-wikidata',
      entries: [entry('h-auto-1', 'update', 'active'), entry('h-auto-2', 'note', 'proposed'), entry('h-auto-3', 'note', 'proposed'), entry('h-auto-4', 'note', 'known-gap')] } };
    const out = buildCatalog([file]);
    expect(out).toContain('| `h-auto-1` | update |');
    expect(out).not.toContain('`h-auto-2`');
    expect(out).not.toContain('`h-auto-4`');
    expect(out).toContain('Machine-generated file: 2 proposed, 1 known-gap entries are not listed here');
    expect(out).toContain('| historical/auto-wikidata.json | note |  | 2 | 1 |  | 3 |'); // still counted in the summary
  });

  it('formats years and geometry specs', () => {
    expect(fmtYears([-500, -1])).toBe('500 BCE–1 BCE');
    expect(fmtYears([1, 'present'])).toBe('1–present');
    expect(fmtYears([1453, 1453])).toBe('1453');
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(describeGeometry({ type: 'difference', base: { type: 'admin0', codes: ['FRA'] }, minus: [{ type: 'record', pid: 'clio:x', year: -300 }] })).toBe('admin-0 FRA minus record clio:x in 300 BCE');
  });
});

describe('catalog summary for AGENTS.md', () => {
  const { files } = loadOverrides(overridesDir);
  const sum = buildSummary(files, 'overrides/CATALOG.md');
  it('keeps the counts per file × op × status and links the full catalog', () => {
    expect(sum).toContain('| historical/test-region.json | add | 1 |  |  |  | 1 |');
    expect(sum).toContain('| **all files** | entries | **3** | **1** | **1** | **1** | **6** |');
    expect(sum).toContain('[overrides/CATALOG.md](overrides/CATALOG.md)');
    expect(sum).toContain('npm run data:catalog');
  });
  it('lists each curated file on one line and no entries, units or sources', () => {
    const lines = sum.split('\n').filter((l) => l.startsWith('- `'));
    expect(lines.map((l) => l.slice(0, l.indexOf('` —') + 1))).toEqual(['- `historical/test-region.json`', '- `modern/test-group.json`']);
    expect(lines[0]).toContain('5 entries (2 active, 1 proposed, 1 known gaps, 1 rejected)');
    expect(lines[1]).toMatch(/unit\(s\)/);
    expect(sum).not.toContain('`h-test-region-0001`');
    expect(sum).not.toContain('| `DEU`');
    expect(sum).not.toContain('### Known gaps');
    expect(sum.length).toBeLessThan(buildCatalog(files).length);
  });
  it('the full catalog document has a title and the whole catalog', () => {
    const doc = catalogDocument(files);
    expect(doc.startsWith('# Override catalog\n')).toBe(true);
    expect(doc).toContain(buildCatalog(files));
  });
});

describe('catalog CLI', () => {
  it('--check fails on a stale catalog, a run updates it, then --check passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    try {
      const agents = join(dir, 'AGENTS.md');
      const catalog = join(dir, 'overrides', 'CATALOG.md');
      copyFileSync(join(fixtures, 'AGENTS.fixture.md'), agents);
      const run = (...extra) => spawnSync(process.execPath, [cli, `--overrides=${overridesDir}`, `--agents=${agents}`, `--catalog=${catalog}`, ...extra], { encoding: 'utf8' });
      expect(run('--check').status).toBe(1);
      mkdirSync(join(dir, 'overrides'));
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      const doc = readFileSync(agents, 'utf8');
      expect(doc.startsWith('# Fixture AGENTS.md\n\nText before the catalog.\n\n' + START + '\n_Generated by')).toBe(true);
      expect(doc.endsWith(END + '\n\nText after the catalog.\n')).toBe(true);
      expect(doc).toContain('[overrides/CATALOG.md](overrides/CATALOG.md)');
      expect(doc).not.toContain('| `h-test-region-0001`'); // entries live in CATALOG.md only
      const full = readFileSync(catalog, 'utf8');
      expect(full).toContain('| `h-test-region-0001`');
      expect(full).toContain('### Known gaps');
      expect(run('--check').status).toBe(0);
      writeFileSync(catalog, full + 'stale\n');
      expect(run('--check').status).toBe(1); // a stale CATALOG.md fails the check too
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
