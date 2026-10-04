#!/usr/bin/env node
// Regenerates the override catalog from overrides/**/*.json:
//   * overrides/CATALOG.md — the FULL catalog (sections 1–4 below);
//   * packages/borders/AGENTS.md between <!-- overrides:start --> and <!-- overrides:end -->
//     — only a compact summary (counts per file × op × status, one line per curated
//     file, a link to CATALOG.md, how to regenerate), so the AGENTS.md agents load
//     stays small.
// Full catalog:
//   1. summary counts per file × op × status (modern files: units, overlays),
//   2. per file a table of entries (id · op · polity/target · years · reason ·
//      sources · confidence · status),
//   3. modern units, one row per unit (periods: years → name; subunits), overlays,
//   4. known gaps (status "known-gap"), listed separately.
// Machine-generated files (auto-*.json) list only their active entries and units;
// their other entries (review suggestions, gap notes) are counted, not listed.
// Output is deterministic (files sorted by path, entries in file order).
//
//   node packages/borders/pipeline/tools/catalog.mjs            # rewrite CATALOG.md + the AGENTS.md summary (npm run data:catalog)
//   node packages/borders/pipeline/tools/catalog.mjs --check    # exit 1 if either is out of date
//   node packages/borders/pipeline/tools/catalog.mjs --stdout   # print the full catalog instead of writing
//   options for tests: --overrides=<dir> --agents=<file> --catalog=<file> --present=<year>
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const borders = resolve(here, '../..');
export const START = '<!-- overrides:start -->';
export const END = '<!-- overrides:end -->';
const OPS = ['add', 'subtract', 'assign', 'update', 'delete', 'note'];
const STATUSES = ['active', 'proposed', 'known-gap', 'rejected'];

// ------------------------------------------------------------------- formatting

/** "500 BCE", "1453", "present". */
export function fmtYear(y) {
  if (y === 'present') return 'present';
  return y < 0 ? `${-y} BCE` : String(y);
}
export const fmtYears = (ys) => (Array.isArray(ys) ? (ys[0] === ys[1] ? fmtYear(ys[0]) : `${fmtYear(ys[0])}–${fmtYear(ys[1])}`) : '');

/** Text safe inside a Markdown table cell. */
export const cell = (s) => String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';
const linkText = (s) => cell(s).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
const linkUrl = (u) => String(u).replace(/\)/g, '%29').replace(/ /g, '%20');
export const sourcesCell = (sources) => (sources ?? []).map((s) => `[${linkText(s.title)}](${linkUrl(s.url)})`).join('; ');

/**
 * Per-file source numbering: table cells show [n](url) and each file section ends
 * with the numbered list, so a source cited by twenty entries is written out once.
 */
export function makeSourceRefs() {
  const list = [];
  const index = new Map();
  return {
    cell(sources) {
      return (sources ?? [])
        .map((s) => {
          const key = `${s.url}\u0000${s.title}`;
          let n = index.get(key);
          if (!n) {
            list.push(s);
            n = list.length;
            index.set(key, n);
          }
          return `[${n}](${linkUrl(s.url)})`;
        })
        .join(' ');
    },
    lines() {
      return list.map((s, i) => `${i + 1}. [${linkText(s.title)}](${linkUrl(s.url)})${s.note ? ` — ${cell(s.note)}` : ''}`);
    },
  };
}

/** Short description of a geometry spec (what area an entry touches). */
export function describeGeometry(g) {
  if (!g || typeof g !== 'object') return '';
  switch (g.type) {
    case 'admin0':
      return `admin-0 ${g.codes.join(', ')}`;
    case 'admin1':
      return `admin-1 ${g.codes.length > 6 ? `${g.codes.slice(0, 6).join(', ')} +${g.codes.length - 6}` : g.codes.join(', ')}`;
    case 'ne-disputed':
      return `NE disputed ${g.codes.join(', ')}`;
    case 'polygon': {
      const polys = g.rings ? [g.rings] : g.polygons ?? [];
      const n = polys.reduce((s, rings) => s + rings.reduce((t, r) => t + r.length - 1, 0), 0);
      return `polygon${polys.length > 1 ? `s ×${polys.length}` : ''} (${n} vertices)`;
    }
    case 'islands':
      return `islands ${g.names?.length ? g.names.join(', ') : `×${g.points.length}`}`;
    case 'record':
      return `record ${g.pid} in ${fmtYear(g.year)}`;
    case 'union':
    case 'intersection':
      return `${g.type}(${g.parts.map(describeGeometry).join(' + ')})`;
    case 'difference':
      return `${describeGeometry(g.base)} minus ${g.minus.map(describeGeometry).join(', ')}`;
    default:
      return String(g.type);
  }
}

function polityCell(e) {
  const s = e.set ?? {};
  const parts = [];
  if (e.op === 'add') {
    parts.push(`**${cell(s.name)}** ${code(s.pid)}`);
    const attrs = [s.kind, s.tier === 1 ? 'tier 1' : null, s.precision === 'approximate' ? 'approximate' : null, s.power ? `power ${s.power}` : null].filter(Boolean);
    if (attrs.length) parts.push(`(${attrs.join(', ')})`);
  } else if (e.target?.pid) {
    parts.push(code(e.target.pid));
    if (e.op === 'update') {
      const changes = Object.entries(s).map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : v}`);
      if (changes.length) parts.push(`set ${cell(changes.join('; '))}`);
    }
  }
  if (e.geometry) parts.push(`— ${cell(describeGeometry(e.geometry))}`);
  if (e.carve === false) parts.push('(no carve)');
  return parts.join(' ');
}

function stateText(st) {
  if (!st) return '';
  if (st.kind === 'unclaimed') return 'unclaimed';
  const extra = [st.kind !== 'state' ? st.kind : null, st.power ? `of ${st.power}` : null].filter(Boolean).join(' ');
  return `${st.name} ${code(st.pid)}${extra ? ` (${extra})` : ''}`;
}
const periodsText = (timeline) => (timeline ?? []).map((p) => `${fmtYears(p.years)} → ${cell(stateText(p.state))}`).join('; ');

// ------------------------------------------------------------------------ loading

export function listOverrideFiles(dir) {
  const out = [];
  for (const kind of ['historical', 'early', 'modern']) {
    const d = join(dir, kind);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) if (f.endsWith('.json')) out.push(join(d, f));
  }
  return out;
}

export function loadOverrides(dir) {
  const files = [];
  const errors = [];
  for (const path of listOverrideFiles(dir)) {
    const rel = relative(dir, path).replaceAll('\\', '/');
    try {
      files.push({ rel, data: JSON.parse(readFileSync(path, 'utf8')) });
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  return { files, errors };
}

// ------------------------------------------------------------------------ catalog

/** Machine-generated override files (pipeline/factcheck writes them as auto-*.json). */
export const isGenerated = (f) => /(^|\/)auto-[^/]*\.json$/.test(f.rel);

/** Builds the Markdown that goes between the markers. */
export function buildCatalog(files) {
  const L = [];
  const entriesOf = (f) => f.data.entries ?? [];
  const nEntries = files.reduce((s, f) => s + entriesOf(f).length, 0);
  const nUnits = files.reduce((s, f) => s + (f.data.units?.length ?? 0), 0);
  const nOverlays = files.reduce((s, f) => s + (f.data.overlays?.length ?? 0), 0);
  L.push(`_Generated by \`npm run data:catalog\` from \`overrides/\` — do not edit by hand. ${files.length} file(s), ${nEntries} entr${nEntries === 1 ? 'y' : 'ies'}, ${nUnits} modern unit(s), ${nOverlays} overlay(s)._`);
  L.push('');
  if (!files.length) {
    L.push('No override files yet.');
    return L.join('\n');
  }

  // 1. summary: file × op × status
  L.push(...summaryTable(files));
  L.push('');
  return L.join('\n') + perFileSections(files, entriesOf);
}

/** Section 1: counts per file × op × status (also the core of the AGENTS.md summary). */
function summaryTable(files) {
  const L = [];
  const entriesOf = (f) => f.data.entries ?? [];
  const nEntries = files.reduce((s, f) => s + entriesOf(f).length, 0);
  L.push('### Summary', '');
  L.push(`| File | Op | ${STATUSES.join(' | ')} | total |`);
  L.push(`| --- | --- | ${STATUSES.map(() => '---:').join(' | ')} | ---: |`);
  const totals = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const f of files) {
    const byOp = new Map();
    for (const e of entriesOf(f)) {
      const op = OPS.includes(e.op) ? e.op : String(e.op);
      if (!byOp.has(op)) byOp.set(op, Object.fromEntries(STATUSES.map((s) => [s, 0])));
      const row = byOp.get(op);
      if (e.status in row) row[e.status]++;
    }
    const ops = [...byOp.keys()].sort((a, b) => OPS.indexOf(a) - OPS.indexOf(b));
    for (const op of ops) {
      const row = byOp.get(op);
      const total = STATUSES.reduce((s, k) => s + row[k], 0);
      for (const k of STATUSES) totals[k] += row[k];
      L.push(`| ${f.rel} | ${op} | ${STATUSES.map((k) => row[k] || '').join(' | ')} | ${total} |`);
    }
    if (f.data.units?.length) L.push(`| ${f.rel} | units | ${STATUSES.map(() => '').join(' | ')} | ${f.data.units.length} |`);
    if (f.data.overlays?.length) L.push(`| ${f.rel} | overlays | ${STATUSES.map(() => '').join(' | ')} | ${f.data.overlays.length} |`);
  }
  L.push(`| **all files** | entries | ${STATUSES.map((k) => `**${totals[k]}**`).join(' | ')} | **${nEntries}** |`);
  return L;
}

/** Sections 2–4: per file entries, modern units and overlays, then the known gaps. */
function perFileSections(files, entriesOf) {
  const L = [''];
  const gaps = [];
  for (const f of files) {
    const d = f.data;
    const refs = makeSourceRefs();
    L.push(`### ${f.rel}`, '');
    L.push(`Kind \`${d.kind ?? '?'}\`, region \`${d.region ?? '?'}\`.${d.scope ? ` Scope: ${cell(d.scope)}` : ''}`);
    L.push('');
    // Machine-generated files (auto-*.json, thousands of review suggestions and gap
    // notes) list only what the build applies: their other entries are counted, so
    // this section stays readable (it lives in an AGENTS.md that agents load).
    const generated = isGenerated(f);
    const listed = (e) => e.status !== 'known-gap' && (!generated || e.status === 'active');
    const entries = entriesOf(f).filter(listed);
    const fileGaps = entriesOf(f).filter((e) => e.status === 'known-gap');
    if (generated) {
      const unlisted = entriesOf(f).filter((e) => !listed(e));
      if (unlisted.length) {
        const by = STATUSES.map((s) => [s, unlisted.filter((e) => e.status === s).length]).filter(([, n]) => n);
        L.push(`Machine-generated file: ${by.map(([s, n]) => `${n} ${s}`).join(', ')} entr${unlisted.length === 1 ? 'y is' : 'ies are'} not listed here (suggestions for review and gap notes; see the file).`, '');
      }
    } else gaps.push(...fileGaps.map((e) => ({ file: f.rel, e })));
    if (entries.length) {
      L.push('| id | op | polity / target | years | reason | sources | confidence | status |');
      L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const e of entries) {
        L.push(`| ${code(e.id)} | ${e.op} | ${polityCell(e)} | ${fmtYears(e.years)} | ${cell(e.reason)} | ${refs.cell(e.sources)} | ${e.confidence ?? ''} | ${e.status ?? ''} |`);
      }
      L.push('');
    }
    if (fileGaps.length && !generated) L.push(`${fileGaps.length} known gap(s) of this file are listed under [Known gaps](#known-gaps).`, '');
    if (d.units?.length) {
      L.push('**Modern units** (who holds each Natural Earth admin-0 unit, year by year):', '');
      L.push('| unit | periods (years → polity) | subunits | sources | confidence |');
      L.push('| --- | --- | --- | --- | --- |');
      for (const u of d.units) {
        const subs = (u.subunits ?? []).map((s) => `${code(s.id)}${s.label ? ` ${cell(s.label)}` : ''} [${cell(describeGeometry(s.geometry))}]: ${periodsText(s.timeline)}`).join('<br>');
        L.push(`| ${code(u.unit)}${u.label ? ` ${cell(u.label)}` : ''} | ${periodsText(u.timeline)} | ${subs} | ${refs.cell([...(u.sources ?? []), ...(u.timeline ?? []).flatMap((p) => p.sources ?? [])])} | ${u.confidence ?? ''} |`);
      }
      L.push('');
    }
    if (d.overlays?.length) {
      L.push('**Overlays** (tier 1, hatched; never change the partition):', '');
      L.push('| id | area | periods | sources | confidence |');
      L.push('| --- | --- | --- | --- | --- |');
      for (const o of d.overlays) {
        const periods = (o.timeline ?? []).map((p) => {
          const s = p.set ?? {};
          const who = [s.name ? `**${cell(s.name)}**` : null, s.pid ? code(s.pid) : null, s.kind, s.controller ? `controlled by ${s.controller}` : null, s.claimants?.length ? `claimed by ${s.claimants.join(', ')}` : null].filter(Boolean).join(' ');
          return `${fmtYears(p.years)} → ${who}`;
        }).join('; ');
        L.push(`| ${code(o.id)}${o.label ? ` ${cell(o.label)}` : ''} | ${cell(describeGeometry(o.geometry))} | ${periods} | ${refs.cell(o.sources)} | ${o.confidence ?? ''} |`);
      }
      L.push('');
    }
    const sourceLines = refs.lines();
    if (sourceLines.length) L.push(`Sources cited in ${f.rel}:`, '', ...sourceLines, '');
  }

  // 4. known gaps
  L.push('### Known gaps', '');
  if (!gaps.length) L.push('None recorded.');
  else {
    L.push('| id | file | about | years | what is missing | sources |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const { file, e } of gaps) L.push(`| ${code(e.id)} | ${file} | ${polityCell(e)} | ${fmtYears(e.years)} | ${cell(e.reason)} | ${sourcesCell(e.sources)} |`);
  }
  return L.join('\n');
}

/** The whole overrides/CATALOG.md file: a title, then the full catalog. */
export function catalogDocument(files) {
  return `# Override catalog\n\nEvery entry, modern unit and overlay in \`packages/borders/overrides/\`, with sources. See \`packages/borders/AGENTS.md\` §4 for the format.\n\n${buildCatalog(files)}\n`;
}

const firstSentence = (s) => {
  const t = cell(s);
  const m = t.match(/^(.{20,200}?\.)(\s|$)/);
  if (m) return m[1];
  return t.length > 160 ? t.slice(0, 160).replace(/\s+\S*$/, '') + ' …' : t;
};

/**
 * The compact text that goes between the markers in packages/borders/AGENTS.md: totals, the
 * file × op × status counts, one line per curated file, a link to the full catalog and how to
 * regenerate it. `link` is the full catalog's path relative to the AGENTS.md file.
 */
export function buildSummary(files, link = 'overrides/CATALOG.md') {
  const entriesOf = (f) => f.data.entries ?? [];
  const nEntries = files.reduce((s, f) => s + entriesOf(f).length, 0);
  const nUnits = files.reduce((s, f) => s + (f.data.units?.length ?? 0), 0);
  const nOverlays = files.reduce((s, f) => s + (f.data.overlays?.length ?? 0), 0);
  const L = [];
  L.push(`_Generated by \`npm run data:catalog\` from \`overrides/\` — do not edit by hand. ${files.length} file(s), ${nEntries} entr${nEntries === 1 ? 'y' : 'ies'}, ${nUnits} modern unit(s), ${nOverlays} overlay(s). **Full catalog** (every entry, unit and overlay with its sources, and the known gaps): [${link}](${link})._`);
  L.push('');
  if (!files.length) {
    L.push('No override files yet.');
    return L.join('\n');
  }
  L.push(...summaryTable(files), '');
  const curated = files.filter((f) => !isGenerated(f));
  L.push('### Curated files', '');
  if (!curated.length) L.push('None yet.');
  for (const f of curated) {
    const d = f.data;
    const es = entriesOf(f);
    const n = (st) => es.filter((e) => e.status === st).length;
    const parts = [`${es.length} entr${es.length === 1 ? 'y' : 'ies'} (${n('active')} active${n('proposed') ? `, ${n('proposed')} proposed` : ''}${n('known-gap') ? `, ${n('known-gap')} known gaps` : ''}${n('rejected') ? `, ${n('rejected')} rejected` : ''})`];
    if (d.units?.length) parts.push(`${d.units.length} unit(s)`);
    if (d.overlays?.length) parts.push(`${d.overlays.length} overlay(s)`);
    L.push(`- \`${f.rel}\` — ${parts.join(', ')}${d.scope ? `. ${firstSentence(d.scope)}` : ''}`);
  }
  const generated = files.filter(isGenerated);
  if (generated.length) {
    L.push('', `Generated by \`pipeline/factcheck/\` (never hand-edit; §4.5): ${generated.map((f) => `\`${f.rel}\``).join(', ')}.`);
  }
  L.push('', `Regenerate with \`npm run data:catalog\` (also the last step of \`npm run data:build\`); \`node packages/borders/pipeline/tools/catalog.mjs --check\` fails when this summary or ${link} is out of date.`);
  return L.join('\n');
}

/** Replaces the text between the markers; throws when they are missing. */
export function replaceSection(doc, body) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error(`markers ${START} … ${END} not found`);
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  return doc.slice(0, a + START.length) + eol + body.replace(/\n/g, eol) + eol + doc.slice(b);
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dir = resolve(opt('overrides') ?? join(borders, 'overrides'));
  const agents = resolve(opt('agents') ?? join(borders, 'AGENTS.md'));
  const { files, errors } = loadOverrides(dir);
  if (errors.length) {
    for (const e of errors) console.error(`error ${e}`);
    console.error('catalog not updated: fix the JSON errors above (npm run data:validate)');
    process.exit(1);
  }
  const catalog = resolve(opt('catalog') ?? join(dir, 'CATALOG.md'));
  if (argv.includes('--stdout')) {
    process.stdout.write(buildCatalog(files) + '\n');
    return;
  }
  const link = relative(dirname(agents), catalog).replaceAll('\\', '/');
  const fullDoc = catalogDocument(files);
  const oldFull = existsSync(catalog) ? readFileSync(catalog, 'utf8').replace(/\r\n/g, '\n') : null;
  const doc = readFileSync(agents, 'utf8');
  const next = replaceSection(doc, buildSummary(files, link));
  if (argv.includes('--check')) {
    const stale = [next !== doc ? relative(process.cwd(), agents) : null, oldFull !== fullDoc ? relative(process.cwd(), catalog) : null].filter(Boolean);
    if (stale.length) {
      console.error(`${stale.join(', ')}: override catalog is out of date — run npm run data:catalog`);
      process.exit(1);
    }
    console.log('override catalog is up to date');
    return;
  }
  if (oldFull !== fullDoc) writeFileSync(catalog, fullDoc);
  if (next !== doc) writeFileSync(agents, next);
  const n = files.reduce((s, f) => s + (f.data.entries?.length ?? 0), 0);
  console.log(`${next !== doc || oldFull !== fullDoc ? 'updated' : 'unchanged'}: ${relative(process.cwd(), catalog)} (full catalog, ${(Buffer.byteLength(fullDoc) / 1024).toFixed(0)} kB) and the summary in ${relative(process.cwd(), agents)} (${files.length} files, ${n} entries)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
