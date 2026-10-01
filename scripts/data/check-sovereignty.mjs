#!/usr/bin/env node
/**
 * Cross-checks every globe snapshot against Wikidata's dates for states,
 * colonies and protectorates, and lists what disagrees for a person to review.
 *
 *   npm run data:check               # uses the cached Wikidata answer if present
 *   npm run data:check -- --refresh  # asks Wikidata again
 *   npm run data:check -- --strict   # exit 1 if any finding is unreviewed (for CI-like use)
 *   npm run data:check -- --too-early  # also list the noisy "too early" check
 *
 * It flags a polity drawn in a year when:
 *   colony      it rules itself, but Wikidata has a colony/protectorate/mandate
 *               of that name in that year (Kenya in 1920);
 *   too early   it rules itself, and every state of that name in Wikidata
 *               begins later (Iceland in 1900). Off unless --too-early: Wikidata
 *               often dates a country from its current constitution
 *               (Ethiopia 1995, Mongolia 1992), so most of these are noise;
 *   still ruled another power rules it, but the present-day state of that name
 *               existed by then (Kenya under the UK in 1970);
 *   ended       it rules itself, but every state of that name had ended.
 *
 * Wikidata is a lead, not an authority: its founding dates are sometimes a
 * later constitution (Nigeria's is the 1963 republic, not 1960 independence)
 * and names are matched exactly, so many polities are simply not checked. A
 * finding that turns out to be right on the map goes in
 * sovereignty-reviewed.json with the reason, and is not reported again.
 * Fixes go in rulers.json or name-overrides.json; see AGENTS.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOTS = join(ROOT, 'public/data/snapshots');
const CACHE = join(ROOT, '.cache/wikidata-sovereignty.json');
const REVIEWED = JSON.parse(readFileSync(join(ROOT, 'scripts/data/sovereignty-reviewed.json'), 'utf8'));
const POWERS = JSON.parse(readFileSync(join(ROOT, 'scripts/data/powers.json'), 'utf8'));
const CANONICAL = new Map(Object.entries(POWERS.aliases).flatMap(([power, names]) => names.map((n) => [n, power])));
const canonical = (name) => CANONICAL.get(name) ?? name;
const args = process.argv.slice(2);

// sovereign state, historical country, unrecognised state
const STATE_TYPES = 'wd:Q3624078 wd:Q3024240 wd:Q1250464';
// colony, crown colony, protectorate, British protectorate, League of Nations
// mandate, UN trust territory, dependent territory, overseas province of Portugal
const DEPENDENCY_TYPES = 'wd:Q133156 wd:Q1351282 wd:Q164142 wd:Q21479969 wd:Q426759 wd:Q985073 wd:Q161243 wd:Q333542';
const SOVEREIGN_STATE = 'http://www.wikidata.org/entity/Q3624078';

const sparql = (types) => `
SELECT ?item ?type ?name ?inception ?dissolved WHERE {
  VALUES ?type { ${types} }
  ?item wdt:P31 ?type .
  { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
  FILTER(lang(?name) = 'en')
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P576 ?dissolved }
}`;

async function ask(query) {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'STRHistoryMapCheck/1.0 (https://history.ethanyanxu.com)' },
  });
  if (!res.ok) throw new Error(`Wikidata query failed: HTTP ${res.status}`);
  return (await res.json()).results.bindings;
}

async function wikidata() {
  if (!args.includes('--refresh')) {
    try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { /* fetch below */ }
  }
  process.stdout.write('Asking Wikidata... ');
  const rows = [
    ...(await ask(sparql(STATE_TYPES))).map((r) => ({ ...r, dependency: false })),
    ...(await ask(sparql(DEPENDENCY_TYPES))).map((r) => ({ ...r, dependency: true })),
  ];
  // One entry per item: its names and the widest date range any statement gives.
  // "Unknown value" statements come back as blank nodes, not dates.
  const year = (v) => {
    const m = v?.match(/^(-?\d+)-\d\d-\d\dT/);
    return m ? Number(m[1]) : null;
  };
  const items = new Map();
  for (const r of rows) {
    const id = r.item.value.split('/').pop();
    const item = items.get(id) ?? { id, names: new Set(), starts: [], ends: [], sovereign: false, dependency: false };
    item.names.add(r.name.value);
    const start = year(r.inception?.value), end = year(r.dissolved?.value);
    if (start !== null) item.starts.push(start);
    if (end !== null) item.ends.push(end);
    item.sovereign ||= r.type?.value === SOVEREIGN_STATE;
    item.dependency ||= r.dependency;
    items.set(id, item);
  }
  const data = {
    fetched: new Date().toISOString().slice(0, 10),
    items: [...items.values()].map(({ names, starts, ends, ...rest }) => ({
      ...rest,
      names: [...names],
      starts: [...new Set(starts)].sort((a, b) => a - b),
      end: ends.length ? Math.max(...ends) : null,
    })),
  };
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
  console.log(`${data.items.length} items.`);
  return data;
}

/** "Tanganyika (UK)" and "the Gambia" both match their plain names. */
const normalise = (name) => name.toLowerCase().replace(/\s*\([^()]*\)\s*$/, '').replace(/^the\s+/, '').trim();

const { fetched, items } = await wikidata();
const byName = new Map();
for (const item of items) for (const name of item.names) {
  const key = normalise(name);
  byName.set(key, [...(byName.get(key) ?? []), item]);
}
const covers = (item, y) => (item.starts[0] ?? -Infinity) <= y && y <= (item.end ?? Infinity);
// A dependency with no known start or end cannot be placed in time ("Colony of Trinidad", 1802–?).
const dated = (item) => item.starts.length > 0 && item.end !== null;
const describe = (item) => `${item.names[0]} (${item.id}, ${item.dependency ? 'dependency' : 'state'} ${item.starts[0] ?? '?'}–${item.end ?? ''})`;

const findings = [];
const years = readdirSync(SNAPSHOTS).map((f) => f.match(/^world_(-?\d+)\.geojson$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
for (const year of years) {
  const { features } = JSON.parse(readFileSync(join(SNAPSHOTS, `world_${year}.geojson`), 'utf8'));
  const seen = new Set();
  for (const { properties: p } of features) {
    if (p.kind || !p.name || seen.has(p.name)) continue;
    seen.add(p.name);
    const matches = byName.get(normalise(p.name)) ?? [];
    if (!matches.length) continue;
    const ruledBy = p.subjecto && normalise(canonical(p.subjecto)) !== normalise(canonical(p.name)) ? p.subjecto : null;
    const states = matches.filter((m) => !m.dependency);
    const report = (check, detail) => findings.push({ key: `${year} ${p.name}`, year, name: p.name, check, detail });
    if (!ruledBy) {
      const colony = matches.find((m) => m.dependency && !m.sovereign && dated(m) && covers(m, year));
      if (colony && !states.some((s) => covers(s, year))) report('colony', `shown ruling itself; Wikidata: ${describe(colony)}`);
      else if (states.length && !matches.some((m) => (!m.dependency || dated(m)) && covers(m, year))) {
        const firstStart = Math.min(...states.map((s) => s.starts[0] ?? Infinity));
        const lastEnd = Math.max(...states.map((s) => s.end ?? Infinity));
        if (Number.isFinite(firstStart) && firstStart > year) report('too early', `shown ruling itself; Wikidata's earliest state of that name begins ${firstStart}: ${describe(states.find((s) => s.starts[0] === firstStart))}`);
        else if (lastEnd < year) report('ended', `shown ruling itself; every state of that name in Wikidata had ended by ${lastEnd}`);
      }
    } else {
      const current = states.filter((s) => s.sovereign && s.end === null && s.starts.length);
      const founded = current.length ? Math.max(...current.map((s) => s.starts.at(-1))) : Infinity;
      if (founded <= year) report('still ruled', `shown ruled by ${ruledBy}; Wikidata: ${describe(current[0])}, latest founding ${founded}`);
    }
  }
}

const shown = findings.filter((f) => f.check !== 'too early' || args.includes('--too-early'));
const open = shown.filter((f) => !REVIEWED[f.key]);
const reviewed = shown.length - open.length;
console.log(`Checked ${years.length} snapshots against Wikidata (fetched ${fetched}).`);
const checks = ['colony', ...(args.includes('--too-early') ? ['too early'] : []), 'still ruled', 'ended'];
for (const check of checks) {
  const list = open.filter((f) => f.check === check);
  if (!list.length) continue;
  console.log(`\n${check} (${list.length}):`);
  for (const f of list) console.log(`  ${f.key}: ${f.detail}`);
}
console.log(`\n${open.length} to review, ${reviewed} already reviewed (scripts/data/sovereignty-reviewed.json).`);
const stale = Object.keys(REVIEWED).filter((k) => k !== '$comment' && !findings.some((f) => f.key === k));
if (stale.length) console.log(`Reviewed entries that no longer come up (remove them): ${stale.join(', ')}`);
if (args.includes('--strict') && open.length) process.exit(1);
