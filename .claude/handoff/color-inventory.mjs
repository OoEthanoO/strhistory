// Inventory of every colour key (power || pid) of tier-0 polities across all frames:
// prominence (area × years), names, years, neighbours, and where its colour comes from.
//   node .claude/handoff/color-inventory.mjs [outDir]   (default .cache/colors; writes inventory.json, pairs.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'packages/borders/data');
const OUT = process.argv[2] ?? '.cache/colors';
fs.mkdirSync(OUT, { recursive: true });
const src = fs.readFileSync(path.join(ROOT, 'src/features/globe/map-colors.ts'), 'utf8');
const identity = new Map();
for (const m of src.match(/const IDENTITY[\s\S]*?\n\];/)[0].matchAll(/\[\s*'(#[0-9a-f]{6})',\s*\[([\s\S]*?)\]\s*,?\s*\]/g)) for (const k of m[2].matchAll(/'([^']+)'/g)) identity.set(k[1], m[1]);
const slots = [...src.match(/SLOT_PALETTE[\s\S]*?\]\);/)[0].matchAll(/'(#[0-9a-f]{6})'/g)].map((m) => m[1]);
const flags = new Map([...fs.readFileSync(path.join(ROOT, 'src/features/globe/country-colors.ts'), 'utf8').matchAll(/'([^']+)': '(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]));
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const polIndex = JSON.parse(fs.readFileSync(path.join(DATA, manifest.polities.file ?? manifest.polities), 'utf8'));
const frames = manifest.frames;
const nextFrame = (y) => { const i = frames.indexOf(y); return i >= 0 && i + 1 < frames.length ? frames[i + 1] : manifest.years.to + 1; };
const keys = new Map();
const pairs = new Map();
for (const ch of manifest.chunks) {
  const topo = JSON.parse(fs.readFileSync(path.join(DATA, ch.files.l0), 'utf8'));
  const geoms = topo.objects.polities.geometries.filter((g) => g.properties?.tier === 0 && g.properties.kind !== 'unclaimed');
  const arcsOf = geoms.map((g) => { const set = new Set(); const walk = (a) => (Array.isArray(a[0]) ? a.forEach(walk) : a.forEach((i) => set.add(i < 0 ? ~i : i))); walk(g.arcs ?? []); return set; });
  for (const y of frames.filter((f) => f >= ch.from && f <= ch.to)) {
    const dur = Math.max(1, Math.min(nextFrame(y), ch.to + 1) - y);
    const byArc = new Map();
    const seenKey = new Set();
    geoms.forEach((g, i) => {
      const p = g.properties;
      if (p.from > y || p.to < y) return;
      const key = p.power || p.pid;
      let e = keys.get(key);
      if (!e) keys.set(key, (e = { key, names: {}, pids: new Set(), areaYears: 0, peakArea: 0, from: y, to: y, kinds: new Set(), slot: p.c, frames: 0 }));
      e.names[p.name] = (e.names[p.name] ?? 0) + p.a * dur;
      e.pids.add(p.pid); e.kinds.add(p.kind);
      e.areaYears += p.a * dur; e.from = Math.min(e.from, y); e.to = Math.max(e.to, y + dur - 1);
      if (!seenKey.has(key)) { e.frames++; seenKey.add(key); }
      e.slot = p.c;
      for (const a of arcsOf[i]) { const l = byArc.get(a); if (l) l.add(key); else byArc.set(a, new Set([key])); }
    });
    // peak area per key per frame
    const areaNow = new Map();
    geoms.forEach((g) => { const p = g.properties; if (p.from > y || p.to < y) return; const k = p.power || p.pid; areaNow.set(k, (areaNow.get(k) ?? 0) + p.a); });
    for (const [k, a] of areaNow) keys.get(k).peakArea = Math.max(keys.get(k).peakArea, a);
    for (const set of byArc.values()) {
      if (set.size < 2) continue;
      const ks = [...set];
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const id = ks[i] < ks[j] ? `${ks[i]}|${ks[j]}` : `${ks[j]}|${ks[i]}`;
        const e = pairs.get(id) ?? { a: ks[i] < ks[j] ? ks[i] : ks[j], b: ks[i] < ks[j] ? ks[j] : ks[i], years: 0, frames: new Set() };
        if (!e.frames.has(y)) { e.frames.add(y); e.years += dur; }
        pairs.set(id, e);
      }
    }
  }
}
const colorOf = (k, slot) => identity.get(k) ? ['identity', identity.get(k)] : flags.get(k) ? ['flag', flags.get(k)] : ['slot', slots[((slot % slots.length) + slots.length) % slots.length]];
const out = [...keys.values()].map((e) => {
  const [source, color] = colorOf(e.key, e.slot);
  const name = Object.entries(e.names).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const neighbours = [...pairs.values()].filter((p) => p.a === e.key || p.b === e.key).map((p) => ({ key: p.a === e.key ? p.b : p.a, years: p.years })).sort((a, b) => b.years - a.years);
  return { key: e.key, name: name[0], otherNames: name.slice(1, 6), pids: [...e.pids].slice(0, 12), wikidata: polIndex[e.key]?.wikidata, from: e.from, to: e.to, areaYears: Math.round(e.areaYears), peakArea: Math.round(e.peakArea), kinds: [...e.kinds], slot: e.slot, source, color, neighbours: neighbours.slice(0, 25) };
}).sort((a, b) => b.areaYears - a.areaYears);
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(OUT, 'pairs.json'), JSON.stringify([...pairs.values()].map((p) => ({ a: p.a, b: p.b, years: p.years, frames: p.frames.size }))));
const total = out.reduce((s, e) => s + e.areaYears, 0);
const bySrc = {};
for (const e of out) bySrc[e.source] = (bySrc[e.source] ?? 0) + e.areaYears;
console.log('keys', out.length, 'share of map area-years by colour source:', Object.fromEntries(Object.entries(bySrc).map(([k, v]) => [k, (100 * v / total).toFixed(1) + '%'])));
console.log('top slot-coloured:');
console.log(out.filter((e) => e.source === 'slot').slice(0, 60).map((e, i) => `${i + 1}. ${e.name} [${e.key}] ${e.from}..${e.to} peak ${Math.round(e.peakArea / 1000)}k km² slot ${e.slot} ${e.color}`).join('\n'));
