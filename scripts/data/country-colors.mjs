// Generates src/features/globe/country-colors.ts: a map colour for every country without a
// classic colour (map-colors.ts IDENTITY), taken from its flag, in pastel tones.
//
//   node scripts/data/country-colors.mjs [--data packages/borders/data]
//
// Each country lists its flag's colours, most characteristic first (Mexico green, Algeria
// green, Libya green …); each colour family has a few pastel shades. A solver picks one
// colour and shade per country so that polities which share a border in any frame of the
// dataset (from the l0 TopoJSON chunks) stay distinct (OKLab ΔE), preferring the flag's
// first colour; classic identity colours and slot colours stay fixed. Historical
// predecessors listed in HISTORY take their modern country's colour. Re-run after the
// dataset changes; never edit the output by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argData = process.argv.indexOf('--data');
const DATA = path.resolve(ROOT, argData > 0 ? process.argv[argData + 1] : 'packages/borders/data');
const COLORS_TS = path.join(ROOT, 'src/features/globe/map-colors.ts');
const OUT = path.join(ROOT, 'src/features/globe/country-colors.ts');

/** Flag colours by country (Natural Earth ADM0_A3, lower case), most characteristic first. */
const FLAGS = {
  // Europe
  alb: ['red', 'maroon'], and: ['blue', 'yellow', 'red'], arm: ['orange', 'red', 'blue'], aze: ['lightblue', 'green', 'red'],
  bel: ['yellow', 'red'], bgr: ['green', 'red', 'white'], bih: ['blue', 'yellow'], blr: ['red', 'green'], che: ['red', 'white'],
  cyp: ['white', 'orange'], cyn: ['red', 'white'], cze: ['blue', 'red', 'white'], est: ['blue', 'white'], fin: ['lightblue', 'white'],
  geo: ['red', 'white'], grc: ['lightblue', 'blue', 'white'], hrv: ['red', 'blue', 'white'], hun: ['green', 'red', 'white'],
  irl: ['green', 'orange'], isl: ['blue', 'red'], kos: ['blue', 'yellow'], lie: ['blue', 'red'], ltu: ['yellow', 'green', 'red'],
  lux: ['lightblue', 'red'], lva: ['maroon', 'white'], mco: ['red', 'white'], mda: ['yellow', 'blue', 'red'], mkd: ['red', 'yellow'],
  mlt: ['red', 'white'], mne: ['red', 'yellow'], nor: ['red', 'blue'], rou: ['yellow', 'blue', 'red'], srb: ['red', 'blue'],
  smr: ['lightblue', 'white'], svk: ['blue', 'red', 'white'], svn: ['blue', 'red'], ukr: ['yellow', 'blue'], vat: ['yellow', 'white'],
  yug: ['blue', 'red'], // Yugoslavia (blue–white–red)
  // Middle East
  are: ['green', 'red'], bhr: ['red', 'white'], egy: ['yellow', 'red'], irn: ['green', 'red'], irq: ['red', 'green'],
  isr: ['lightblue', 'blue'], jor: ['green', 'red'], kwt: ['green', 'red'], lbn: ['red', 'green'], omn: ['red', 'green'],
  psx: ['green', 'red'], qat: ['maroon'], sau: ['green'], syr: ['red', 'green'], yem: ['red', 'white'], uar: ['red', 'green'],
  // Asia
  afg: ['green', 'red'], bgd: ['green', 'red'], btn: ['orange', 'yellow'], brn: ['yellow'], khm: ['blue', 'red'],
  idn: ['red', 'white'], kaz: ['lightblue', 'yellow'], kgz: ['red', 'yellow'], lao: ['red', 'blue'], lka: ['maroon', 'orange', 'yellow'],
  mdv: ['red', 'green'], mmr: ['yellow', 'green', 'red'], mng: ['red', 'blue'], mys: ['blue', 'red', 'yellow'], npl: ['red', 'blue'],
  pak: ['darkgreen', 'green'], phl: ['blue', 'red', 'yellow'], prk: ['red', 'blue'], kor: ['white', 'blue', 'red'], sgp: ['red', 'white'],
  tha: ['blue', 'red'], tjk: ['green', 'red', 'white'], tkm: ['green'], tls: ['red', 'yellow'], uzb: ['lightblue', 'green'], vnm: ['red', 'yellow'],
  kas: ['white'], scr: ['white'], pga: ['white'], brt: ['white'], cnm: ['white'], sah: ['white'],
  // Africa
  dza: ['green', 'white'], ago: ['red', 'yellow'], ben: ['green', 'yellow', 'red'], bwa: ['lightblue'], bfa: ['red', 'green'],
  bdi: ['red', 'green'], cmr: ['green', 'red', 'yellow'], cpv: ['blue'], caf: ['blue', 'green', 'yellow'], tcd: ['blue', 'yellow', 'red'],
  com: ['green', 'yellow', 'blue'], cod: ['lightblue', 'yellow', 'red'], cog: ['green', 'yellow', 'red'], civ: ['orange', 'green'],
  dji: ['lightblue', 'green'], gnq: ['green', 'red'], eri: ['green', 'blue', 'red'], swz: ['blue', 'red'], eth: ['green', 'yellow', 'red'],
  gab: ['green', 'yellow', 'blue'], gmb: ['red', 'blue', 'green'], gha: ['yellow', 'red', 'green'], gin: ['red', 'yellow', 'green'],
  gnb: ['yellow', 'red', 'green'], ken: ['red', 'green'], lso: ['blue', 'green'], lbr: ['red', 'blue'], lby: ['green', 'red'],
  mdg: ['red', 'green', 'white'], mwi: ['red', 'green'], mli: ['yellow', 'green', 'red'], mrt: ['green', 'yellow'], mus: ['red', 'blue'],
  mar: ['red', 'green'], moz: ['green', 'yellow', 'red'], nam: ['blue', 'red', 'green'], ner: ['orange', 'green'], nga: ['green', 'white'],
  rwa: ['lightblue', 'yellow', 'green'], stp: ['green', 'yellow'], sen: ['green', 'yellow', 'red'], syc: ['blue', 'red'],
  sle: ['green', 'lightblue'], som: ['lightblue'], sol: ['green', 'red'], zaf: ['green', 'yellow', 'blue', 'red'], sds: ['green', 'blue', 'red'],
  sdn: ['red', 'green'], tza: ['green', 'lightblue', 'yellow'], tgo: ['green', 'yellow'], tun: ['red'], uga: ['yellow', 'red'],
  zmb: ['green', 'orange', 'red'], zwe: ['green', 'yellow', 'red'], mfd: ['green', 'yellow', 'red'], // Mali Federation
  // Americas
  atg: ['red', 'blue'], arg: ['lightblue'], bhs: ['lightblue', 'yellow'], brb: ['blue', 'yellow'], blz: ['blue', 'red'],
  bol: ['yellow', 'red', 'green'], chl: ['red', 'blue'], col: ['yellow', 'blue', 'red'], cri: ['blue', 'red'], cub: ['blue', 'red'],
  dma: ['green'], dom: ['blue', 'red'], ecu: ['yellow', 'blue', 'red'], slv: ['blue'], grd: ['red', 'green'], gtm: ['lightblue'],
  guy: ['green', 'yellow'], hti: ['blue', 'red'], hnd: ['blue'], jam: ['green', 'yellow'], mex: ['green'], nic: ['blue'],
  pan: ['red', 'blue'], pry: ['red', 'blue'], per: ['red'], kna: ['green', 'red'], lca: ['lightblue'], vct: ['green', 'yellow', 'blue'],
  sur: ['green', 'red'], tto: ['red'], ury: ['lightblue', 'white'], ven: ['yellow', 'blue', 'red'],
  // Oceania
  aus: ['blue', 'red'], nzl: ['blue'], fji: ['lightblue'], fsm: ['lightblue'], kir: ['red', 'blue'], mhl: ['blue', 'orange'],
  nru: ['blue', 'yellow'], plw: ['lightblue', 'yellow'], png: ['red', 'yellow'], wsm: ['red', 'blue'], slb: ['blue', 'green'],
  ton: ['red'], tuv: ['lightblue'], vut: ['green', 'red'],
};

/** Colour keys that take a country's flag colour: the modern unit, plus clear predecessors and successors. */
const HISTORY = {
  irn: ['clio:afsharid-iran', 'clio:qajar-dynasty', 'clio:pahlavi-dynasty'],
  alb: ['clio:albania'],
  arg: ['clio:argentine-confederation', 'clio:argentine-republic'],
  bhr: ['clio:bahrain'],
  tun: ['clio:beylik-of-tunis'],
  bol: ['clio:bolivia'],
  mmr: ['clio:burma'],
  khm: ['clio:cambodia'],
  mex: ['clio:first-mexican-empire', 'clio:federated-republic-of-mexico', 'clio:centralist-mexico', 'clio:second-mexican-empire', 'clio:mexico'],
  cze: ['clio:czechoslovakia', 'ovr:czechoslovakia'],
  dom: ['clio:dominican-republic'],
  afg: ['clio:emirate-of-afghanistan', 'clio:kingdom-of-afghanistan'],
  sau: ['clio:emirate-of-nejd', 'clio:kingdom-of-hejaz-and-nejd', 'clio:kingdom-of-saudi-arabia'],
  hti: ['clio:empire-of-haiti', 'clio:republic-of-haiti'],
  eth: ['clio:ethiopian-empire', 'clio:ethiopia'],
  grc: ['clio:first-hellenic-republic', 'clio:kingdom-of-greece'],
  col: ['clio:new-granada', 'clio:gran-colombia', 'clio:republic-of-new-granada', 'clio:united-states-of-colombia', 'clio:republic-of-colombia'],
  mng: ['clio:great-mongol-state', 'clio:mongolian-people-s-republic'],
  gtm: ['clio:guatemala'],
  hnd: ['clio:honduras'],
  cri: ['clio:republic-of-costa-rica'],
  slv: ['clio:republic-of-el-salvador'],
  nic: ['clio:republic-of-nicaragua'],
  omn: ['clio:sultanate-of-oman', 'clio:imamate-of-oman', 'clio:sultanate-of-muscat-and-oman'],
  yem: ['clio:imamate-of-yemen', 'clio:north-yemen'],
  egy: ['clio:muhammad-ali-dynasty', 'clio:khedivate-of-egypt', 'clio:kingdom-of-egypt'],
  bel: ['clio:kingdom-of-belgium'],
  btn: ['clio:kingdom-of-bhutan'],
  irq: ['clio:kingdom-of-iraq'],
  nor: ['clio:kingdom-of-norway'],
  rou: ['clio:kingdom-of-romania'],
  srb: ['clio:kingdom-of-serbia', 'clio:serbia', 'ovr:serbia-and-montenegro', 'ovr:fr-yugoslavia'],
  tha: ['clio:rattanakosin-kingdom', 'clio:kingdom-of-thailand'],
  kwt: ['clio:kuwait'],
  lbn: ['clio:lebanon'],
  mdg: ['clio:merina-kingdom'],
  mne: ['clio:montenegro'],
  mar: ['clio:morocco'],
  npl: ['clio:nepal'],
  ury: ['clio:oriental-republic-of-uruguay'],
  pry: ['clio:paraguay'],
  bgr: ['clio:principality-of-bulgaria'],
  qat: ['clio:qatar-dynasty', 'clio:qatar'],
  dza: ['clio:regency-of-algiers'],
  chl: ['clio:republic-of-chile'],
  cub: ['clio:republic-of-cuba'],
  ecu: ['clio:republic-of-ecuador'],
  fin: ['clio:republic-of-finland'],
  lbr: ['clio:republic-of-liberia'],
  per: ['clio:republic-of-peru'],
  ven: ['clio:republic-of-venezuela', 'clio:venezuela'],
  zaf: ['clio:south-africa'],
  che: ['clio:swiss-confederation'],
  yug: ['clio:yugoslavia', 'ovr:yugoslavia'],
  uar: ['ovr:united-arab-republic'],
  lby: ['ovr:allied-administration-of-libya'],
  sgp: ['ovr:state-of-singapore'],
  mfd: ['ovr:mali-federation'],
};

/** Pastel shades per colour family, as OKLCH [L, C, h]; the first is preferred. */
const SHADES = {
  red: [[0.7, 0.13, 25], [0.77, 0.1, 20], [0.63, 0.14, 28], [0.73, 0.12, 35]],
  maroon: [[0.56, 0.11, 10], [0.63, 0.1, 5], [0.6, 0.11, 0]],
  orange: [[0.77, 0.13, 55], [0.83, 0.1, 62], [0.72, 0.13, 48]],
  yellow: [[0.88, 0.12, 95], [0.82, 0.13, 82], [0.92, 0.08, 102], [0.85, 0.1, 110]],
  green: [[0.73, 0.12, 145], [0.65, 0.12, 152], [0.81, 0.1, 135], [0.7, 0.1, 165]],
  darkgreen: [[0.57, 0.1, 155], [0.63, 0.1, 160]],
  lightblue: [[0.8, 0.08, 235], [0.74, 0.09, 228], [0.85, 0.06, 220]],
  blue: [[0.67, 0.12, 262], [0.73, 0.1, 255], [0.6, 0.12, 266], [0.7, 0.1, 280]],
  white: [[0.93, 0.015, 95], [0.88, 0.02, 85]],
};

// ---- colour maths (OKLab) -----------------------------------------------------------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklchToHex([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((v) => Math.round(fromLin(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('');
}
const lab = new Map();
const dE = (x, y) => {
  let p = lab.get(x);
  if (!p) lab.set(x, (p = hexToOklab(x)));
  let q = lab.get(y);
  if (!q) lab.set(y, (q = hexToOklab(y)));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
};

// ---- fixed colours from map-colors.ts ---------------------------------------------------
const src = fs.readFileSync(COLORS_TS, 'utf8');
const slots = [...src.match(/SLOT_PALETTE[\s\S]*?\]\);/)[0].matchAll(/'(#[0-9a-f]{6})'/g)].map((m) => m[1]);
const identity = new Map();
for (const m of src.match(/const IDENTITY[\s\S]*?\n\];/)[0].matchAll(/\[\s*'(#[0-9a-f]{6})',\s*\[([\s\S]*?)\]\s*,?\s*\]/g)) {
  for (const k of m[2].matchAll(/'([^']+)'/g)) identity.set(k[1], m[1]);
}
const sea = src.match(/ocean: '(#[0-9a-f]{6})'/)[1];
const land = src.match(/land: '(#[0-9a-f]{6})'/)[1];

// ---- variables: colour key → country code ---------------------------------------------
const country = new Map();
for (const code of Object.keys(FLAGS)) {
  if (!identity.has(`ne:${code}`)) country.set(`ne:${code}`, code);
  for (const k of HISTORY[code] ?? []) if (!identity.has(k)) country.set(k, code);
}

// ---- neighbours: colour keys sharing an arc in any frame (l0 chunks) --------------------
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const slotOf = new Map();
const pairs = new Map();
for (const ch of manifest.chunks) {
  const topo = JSON.parse(fs.readFileSync(path.join(DATA, ch.files.l0), 'utf8'));
  const geoms = topo.objects.polities.geometries.filter((g) => g.properties?.tier === 0 && g.properties.kind !== 'unclaimed');
  const arcsOf = geoms.map((g) => {
    const set = new Set();
    const walk = (a) => (Array.isArray(a[0]) ? a.forEach(walk) : a.forEach((i) => set.add(i < 0 ? ~i : i)));
    walk(g.arcs ?? []);
    return set;
  });
  for (const y of manifest.frames.filter((f) => f >= ch.from && f <= ch.to)) {
    const byArc = new Map();
    geoms.forEach((g, i) => {
      if (g.properties.from > y || g.properties.to < y) return;
      const key = g.properties.power || g.properties.pid;
      slotOf.set(key, g.properties.c);
      for (const a of arcsOf[i]) {
        const l = byArc.get(a);
        if (l) l.add(key);
        else byArc.set(a, new Set([key]));
      }
    });
    for (const set of byArc.values()) {
      if (set.size < 2) continue;
      const ks = [...set];
      for (let i = 0; i < ks.length; i++) {
        for (let j = i + 1; j < ks.length; j++) {
          if (!country.has(ks[i]) && !country.has(ks[j])) continue;
          const id = ks[i] < ks[j] ? `${ks[i]}|${ks[j]}` : `${ks[j]}|${ks[i]}`;
          const e = pairs.get(id) ?? { a: ks[i] < ks[j] ? ks[i] : ks[j], b: ks[i] < ks[j] ? ks[j] : ks[i], frames: new Set() };
          e.frames.add(y);
          pairs.set(id, e);
        }
      }
    }
  }
}
const fixedColor = (k) => identity.get(k) ?? slots[(((slotOf.get(k) ?? 0) % slots.length) + slots.length) % slots.length];

// ---- solve -------------------------------------------------------------------------------
// Candidates per country code (shared by all its keys), with a preference cost.
const candidates = new Map();
for (const [code, families] of Object.entries(FLAGS)) {
  const list = [];
  families.forEach((fam, r) => (SHADES[fam] ?? []).forEach((lch, s) => list.push({ hex: oklchToHex(lch), cost: 6 * r + 2 * s })));
  candidates.set(code, list);
}
const codes = [...new Set(country.values())];
const pick = new Map(codes.map((c) => [c, 0]));
const colorOfKey = (k) => (country.has(k) ? candidates.get(country.get(k))[pick.get(country.get(k))].hex : fixedColor(k));
const edges = new Map(codes.map((c) => [c, []]));
for (const e of pairs.values()) {
  const w = Math.sqrt(e.frames.size);
  for (const [k, other] of [[e.a, e.b], [e.b, e.a]]) if (country.has(k)) edges.get(country.get(k)).push({ other, w });
}
const penalty = (d) => Math.max(0, 14 - d) ** 2;
const localCost = (code, idx) => {
  const c = candidates.get(code)[idx];
  let cost = c.cost + 3 * penalty(dE(c.hex, sea)) + penalty(dE(c.hex, land));
  for (const { other, w } of edges.get(code)) {
    if (country.get(other) === code) continue; // the same country under another key
    cost += w * penalty(dE(c.hex, colorOfKey(other)));
  }
  return cost;
};
const totalCost = () => codes.reduce((sum, c) => sum + localCost(c, pick.get(c)), 0);
// Local search from the preferred colours, then from seeded random starts; keep the best.
let seed = 20261002;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let bestPick = null;
let bestTotal = Infinity;
for (let start = 0; start < 12; start++) {
  for (const c of codes) pick.set(c, start === 0 ? 0 : Math.floor(rnd() * Math.min(3, candidates.get(c).length)));
  descend();
  const t = totalCost();
  if (t < bestTotal) {
    bestTotal = t;
    bestPick = new Map(pick);
  }
}
for (const [c, i] of bestPick) pick.set(c, i);
console.log(`total cost ${bestTotal.toFixed(0)}`);

function descend() {
for (let pass = 0; pass < 30; pass++) {
  let changed = 0;
  for (const code of codes) {
    let best = pick.get(code);
    let bestCost = localCost(code, best);
    candidates.get(code).forEach((_, i) => {
      const c = localCost(code, i);
      if (c < bestCost - 1e-9) {
        best = i;
        bestCost = c;
      }
    });
    if (best !== pick.get(code)) {
      pick.set(code, best);
      changed++;
    }
  }
  if (!changed) break;
}
}

// ---- report and write -------------------------------------------------------------------
let worst = [];
for (const e of pairs.values()) {
  const d = dE(colorOfKey(e.a), colorOfKey(e.b));
  if (country.get(e.a) && country.get(e.a) === country.get(e.b)) continue;
  worst.push([d, e.a, e.b, e.frames.size]);
}
worst.sort((x, y) => x[0] - y[0]);
console.log(`${codes.length} countries, ${country.size} colour keys, ${pairs.size} neighbour pairs involving them`);
console.log(`closest neighbours (ΔE): ${worst.slice(0, 8).map(([d, a, b, f]) => `${a}/${b} ${d.toFixed(1)} (${f} fr)`).join('; ')}`);
console.log(`pairs below ΔE 8: ${worst.filter((w) => w[0] < 8).length}; first-choice colours: ${codes.filter((c) => candidates.get(c)[pick.get(c)].cost < 6).length}/${codes.length}`);

const entries = [...country].sort(([a], [b]) => a.localeCompare(b)).map(([k, code]) => `  '${k}': '${candidates.get(code)[pick.get(code)].hex}',`);
fs.writeFileSync(
  OUT,
  `// Generated by scripts/data/country-colors.mjs from the dataset's borders; do not edit by hand.
// Colours of countries without a classic colour (map-colors.ts IDENTITY), from their
// flags in pastel tones, chosen so that neighbours stay distinct; historical
// predecessors listed in the script share their modern country's colour.
export const COUNTRY_COLORS: Readonly<Record<string, string>> = {
${entries.join('\n')}
};
`,
);
console.log(`wrote ${path.relative(ROOT, OUT)} (${entries.length} keys)`);
