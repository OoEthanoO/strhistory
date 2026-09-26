#!/usr/bin/env node
/**
 * Fast content lint — reports every problem at once (the Astro build stops at
 * the first). Run with `npm run check:content`.
 *
 * Checks:
 *  - frontmatter in every .md/.mdx under src/content parses as YAML
 *  - every <Term id="…"> in topics and guides has a glossary entry
 *  - references between collections (topic → unit/related/authors, etc.) exist
 *  - notes have a valid date range and geographic location
 *  - current notes reference the current curriculum and correct level
 *  - snapshots have their declared border file, unless explicitly land-only
 *
 * Schema validation (required fields, types, references) is left to
 * `astro check` / `astro build`, which use the real schemas in src/schemas/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { load as parseYaml } from 'js-yaml';

const ROOT = process.cwd();
const CONTENT = join(ROOT, 'src/content');
const problems = [];

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(CONTENT).filter((f) => /\.mdx?$/.test(f) && !basename(f).startsWith('_'));
const glossaryIds = new Set(
  readdirSync(join(CONTENT, 'glossary'))
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.replace(/\.md$/, '')),
);

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    problems.push(`${rel}: missing frontmatter (--- … ---)`);
    continue;
  }
  let data;
  try {
    data = parseYaml(fm[1]) ?? {};
  } catch (err) {
    problems.push(
      `${rel}: invalid YAML — ${err.message.split('\n')[0]}\n    Tip: wrap values that contain ": " or start with a quote in quotes.`,
    );
    continue;
  }
  if (/\/topics\//.test(rel)) {
    const { start, end } = data.period ?? {};
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      problems.push(`${rel}: period needs integer start/end years, with end on or after start`);
    }
    const { lat, lng, place } = data.location ?? {};
    if (typeof place !== 'string' || !place.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      problems.push(`${rel}: location needs a named place, latitude -90 to 90 and longitude -180 to 180`);
    }
    if (data.curriculum === '2028' && !['SL', 'HL'].includes(data.level)) {
      problems.push(`${rel}: current course notes must explicitly declare level: SL or HL`);
    }
  }
  if (/\/(topics|guides)\//.test(rel)) {
    for (const m of text.matchAll(/<Term\s+[^>]*id=["']([^"']+)["']/g)) {
      if (!glossaryIds.has(m[1])) problems.push(`${rel}: <Term id="${m[1]}"> has no src/content/glossary/${m[1]}.md`);
    }
  }
}

// References between collections (frontmatter field → target collection).
// Astro only warns about a dangling reference, then the page that uses it fails.
const REFERENCES = {
  topics: { unit: 'syllabus', related: 'topics', authors: 'teachers' },
  glossary: { related: 'glossary' },
  teachers: { courses: 'courses' },
  courses: { units: 'syllabus' },
};
const idsIn = (collection) =>
  new Set(
    readdirSync(join(CONTENT, collection))
      .filter((f) => /\.mdx?$/.test(f) && !f.startsWith('_'))
      .map((f) => f.replace(/\.mdx?$/, '')),
  );
for (const [collection, fields] of Object.entries(REFERENCES)) {
  for (const file of readdirSync(join(CONTENT, collection)).filter((f) => /\.mdx?$/.test(f) && !f.startsWith('_'))) {
    const text = readFileSync(join(CONTENT, collection, file), 'utf8').replace(/\r\n/g, '\n');
    let data;
    try {
      data = parseYaml(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {};
    } catch {
      continue; // already reported above
    }
    for (const [field, target] of Object.entries(fields)) {
      const targetIds = idsIn(target);
      for (const id of [data[field]].flat().filter(Boolean)) {
        if (!targetIds.has(String(id))) {
          problems.push(`src/content/${collection}/${file}: ${field} → "${id}" does not exist in src/content/${target}/`);
        }
      }
    }
    if (collection === 'topics' && data.unit && existsSync(join(CONTENT, 'syllabus', `${data.unit}.md`))) {
      const unitText = readFileSync(join(CONTENT, 'syllabus', `${data.unit}.md`), 'utf8').replace(/\r\n/g, '\n');
      let unit;
      try { unit = parseYaml(unitText.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {}; }
      catch { continue; }
      if ((data.curriculum ?? 'archive') !== (unit.curriculum ?? 'archive')) {
        problems.push(`src/content/topics/${file}: curriculum must match its syllabus unit "${data.unit}"`);
      }
      if (data.curriculum === '2028' && unit.levels === 'HL only' && data.level !== 'HL') {
        problems.push(`src/content/topics/${file}: notes for an HL-only unit must declare level: HL`);
      }
    }
  }
}

for (const f of readdirSync(join(CONTENT, 'snapshots')).filter((f) => f.endsWith('.md') && !f.startsWith('_'))) {
  const text = readFileSync(join(CONTENT, 'snapshots', f), 'utf8').replace(/\r\n/g, '\n');
  let data;
  try { data = parseYaml(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {}; }
  catch { continue; }
  const borderYear = data.borderYear === undefined ? data.year : data.borderYear;
  if (borderYear === null) continue;
  if (!Number.isInteger(borderYear)) {
    problems.push(`src/content/snapshots/${f}: borderYear must be an integer or null`);
  } else if (!existsSync(join(ROOT, `public/data/snapshots/world_${borderYear}.geojson`))) {
    problems.push(`src/content/snapshots/${f}: no border file for ${borderYear} — run \`npm run data:snapshots -- ${borderYear}\``);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} content problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log(`✓ ${files.length} content files OK (${glossaryIds.size} glossary terms).`);
