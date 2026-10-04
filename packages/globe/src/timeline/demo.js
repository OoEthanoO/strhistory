// Standalone demo of the Timeline component (plain JS so the package's TypeScript
// build never compiles it). Run:
//   npx vite --config packages/globe/src/timeline/demo.vite.config.mjs  → /demo.html
// /demo.html shows the default (stacked) timeline; /demo.html?layout=bar the bar layout
// as the reference site uses it (apps/site/src/app.ts: layout 'bar', step 1, no change
// buttons, the typed year), with the same bar showing the year as a label above it.
// The demo reads the built dataset (manifest.json + polity index) when it exists and
// falls back to the embedded change years below otherwise.
import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import './timeline.css';
import { formatYear } from '@alexs-atlas/borders';
import { DEFAULT_ERAS, Timeline } from './index.ts';

// Used only when packages/borders/data has not been built: the change years of the
// development build of 2026-10-01 (Cliopatria v0.2.0 up to 1945, then the 1946
// cut-over), followed by well-known later border changes (partition of India 1947 …
// South Sudan 2011). Illustrative; the real list is manifest.frames.
const FALLBACK_FRAMES = [
  -3400, -3200, -3000, -2700, -2500, -2300, -2250, -2200, -2100, -2000, -1800, -1760, -1750, -1700,
  -1600, -1500, -1400, -1300, -1240, -1220, -1200, -1150, -1100, -1000, -900, -800, -750, -700,
  -675, -650, -630, -615, -600, -550, -540, -530, -500, -480, -450, -404, -383, -366, -350, -337,
  -333, -331, -326, -323, -318, -315, -307, -301, -291, -284, -283, -281, -279, -277, -275, -272,
  -271, -264, -256, -247, -239, -230, -225, -223, -222, -218, -216, -212, -210, -208, -206, -203,
  -202, -197, -188, -170, -164, -144, -126, -110, -91, -87, -77, -66, -63, -50, -49, -48, -46, -44,
  -42, -41, -40, -36, -31, -30, -27, -25, -19, -14, 1, 6, 9, 14, 23, 30, 43, 51, 60, 68, 78, 84, 91,
  106, 114, 117, 127, 154, 161, 165, 184, 197, 207, 215, 224, 238, 247, 260, 261, 263, 265, 270,
  283, 287, 299, 306, 308, 311, 313, 324, 337, 338, 347, 353, 358, 367, 371, 373, 378, 383, 387,
  390, 392, 394, 395, 396, 397, 402, 407, 410, 414, 417, 426, 439, 441, 443, 451, 452, 455, 458,
  459, 462, 469, 476, 480, 490, 500, 510, 523, 534, 536, 540, 546, 555, 561, 567, 569, 577, 587,
  592, 602, 612, 617, 623, 626, 627, 628, 629, 630, 633, 634, 638, 641, 644, 647, 656, 661, 666,
  674, 682, 692, 705, 710, 718, 724, 732, 741, 750, 751, 755, 757, 763, 768, 772, 775, 778, 783,
  788, 793, 800, 806, 814, 825, 830, 840, 850, 860, 866, 870, 875, 876, 878, 880, 882, 884, 886,
  887, 888, 892, 896, 898, 899, 900, 911, 922, 926, 936, 947, 960, 961, 962, 970, 980, 990, 1000,
  1003, 1010, 1015, 1018, 1028, 1034, 1040, 1046, 1056, 1066, 1072, 1085, 1094, 1099, 1111, 1126,
  1139, 1147, 1152, 1169, 1177, 1188, 1192, 1202, 1206, 1210, 1216, 1220, 1227, 1236, 1241, 1250,
  1260, 1272, 1279, 1285, 1294, 1305, 1314, 1326, 1333, 1344, 1352, 1363, 1375, 1385, 1395, 1402,
  1407, 1415, 1422, 1429, 1431, 1440, 1450, 1453, 1459, 1463, 1468, 1475, 1482, 1487, 1492, 1497,
  1502, 1507, 1512, 1516, 1519, 1521, 1526, 1529, 1534, 1540, 1547, 1552, 1556, 1564, 1572, 1579,
  1582, 1588, 1595, 1600, 1602, 1609, 1612, 1619, 1622, 1626, 1629, 1632, 1636, 1640, 1642, 1645,
  1648, 1653, 1659, 1662, 1670, 1673, 1677, 1683, 1687, 1691, 1696, 1700, 1702, 1706, 1709, 1713,
  1718, 1721, 1727, 1734, 1738, 1741, 1744, 1748, 1752, 1757, 1762, 1763, 1769, 1772, 1775, 1776,
  1778, 1780, 1781, 1783, 1788, 1791, 1792, 1794, 1796, 1797, 1799, 1800, 1803, 1805, 1806, 1807,
  1809, 1811, 1812, 1814, 1815, 1820, 1822, 1824, 1825, 1828, 1830, 1834, 1836, 1840, 1842, 1846,
  1848, 1849, 1853, 1856, 1857, 1859, 1860, 1861, 1862, 1863, 1864, 1865, 1866, 1868, 1870, 1871,
  1873, 1877, 1880, 1885, 1890, 1895, 1898, 1900, 1905, 1908, 1911, 1912, 1913, 1914, 1915, 1916,
  1917, 1918, 1919, 1920, 1922, 1924, 1926, 1927, 1928, 1929, 1930, 1932, 1936, 1938, 1939, 1940,
  1941, 1942, 1943, 1944, 1945, 1946,
  // Later changes: 1947 India and Pakistan, 1948 Israel, Burma and the two Koreas, 1949 Indonesia
  // and the two Germanies, 1951 Libya, 1956–1966 decolonisation of Africa and Asia, 1967 South
  // Yemen, 1971 Bangladesh, 1975 Angola, Mozambique and Vietnam, 1990 Germany, Yemen and Namibia,
  // 1991 the Soviet Union and Yugoslavia, 1993 Czechia, Slovakia and Eritrea, 2002 East Timor,
  // 2006 Montenegro, 2008 Kosovo, 2011 South Sudan.
  1947, 1948, 1949, 1951, 1956, 1957, 1958, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1967, 1971,
  1975, 1990, 1991, 1993, 2002, 2006, 2008, 2011,
];

// Conventional lifespans, used only when the polity index is not available.
const FALLBACK_SPANS = {
  'Roman Empire': [[-27, 476]],
  'Inca Empire': [[1438, 1533]],
  'Ottoman Empire': [[1299, 1922]],
};

const QUICK = ['Roman Empire', 'Inca Empire', 'Byzantine Empire', 'Ottoman Empire'];

async function loadDataset() {
  try {
    const res = await fetch('./manifest.json', { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const manifest = await res.json();
    let polities = null;
    const idx = await fetch(`./${manifest.polities}`);
    if (idx.ok) polities = await idx.json();
    return { manifest, polities };
  } catch {
    return null;
  }
}

const $ = (id) => document.getElementById(id);
const data = await loadDataset();
const years = data?.manifest?.years ?? { from: -3400, to: 2026, present: 2026 };
const datasetFrames = data?.manifest?.frames ?? FALLBACK_FRAMES;
const polities = data?.polities ? Object.entries(data.polities) : [];

const fmtSpan = (spans) => spans.map(([a, b]) => `${formatYear(a)}–${formatYear(b)}`).join(', ');
const log = (text) => {
  const li = document.createElement('li');
  li.textContent = text;
  $('demo-log').prepend(li);
  while ($('demo-log').children.length > 6) $('demo-log').lastElementChild.remove();
};
const eraOf = (y) => DEFAULT_ERAS.find((e) => (e.from ?? -Infinity) <= y && y <= (e.to ?? Infinity));
const show = (y) => {
  $('demo-year').textContent = y < 0 ? formatYear(y) : y < 1000 ? formatYear(y, { ce: true }) : formatYear(y);
  const era = eraOf(y);
  $('demo-era').textContent = era ? (era.title ?? era.label).split(' · ')[0] : ' ';
};

const barLayout = new URLSearchParams(location.search).get('layout') === 'bar';
document.body.classList.toggle('demo-bar', barLayout);
$('demo-bars').hidden = !barLayout;
$('demo-layout').textContent = barLayout ? 'Stacked layout' : 'Bar layout (site)';
$('demo-layout').setAttribute('href', barLayout ? '?' : '?layout=bar');

// Every timeline on the page shows the same year (the bar view has two).
const timelines = [];
function addTimeline(container, options) {
  const self = new Timeline(container, {
    min: years.from,
    max: years.to,
    present: years.present,
    value: 1453,
    frames: datasetFrames,
    ...options,
    onInput: (y) => {
      show(y);
      for (const t of timelines) if (t !== self) t.setValue(y);
    },
    onChange: (y) => log(`onChange  ${formatYear(y)}`),
    onPlayChange: (playing) => {
      if (playing) for (const t of timelines) if (t !== self) t.pause();
      log(playing ? 'play' : 'pause');
    },
  });
  timelines.push(self);
  return self;
}
// The reference site's options (apps/site/src/app.ts).
const SITE_BAR = { layout: 'bar', step: 1, yearField: 'input', changeButtons: false };
const timeline = barLayout ? addTimeline($('demo-timeline-bar'), SITE_BAR) : addTimeline($('demo-timeline'), {});
if (barLayout) {
  addTimeline($('demo-timeline-label'), { ...SITE_BAR, yearField: 'label', labels: { timeline: 'Timeline (year as a label)' } });
}
show(timeline.getValue());
// Handles for the screenshot script and the console. setValue never calls back, so the
// demo's own readout is refreshed explicitly. demoTimeline: the stacked timeline, or in
// the bar view the site's bar (typed year); demoTimelines: every timeline on the page.
window.demoTimeline = timeline;
window.demoTimelines = timelines;
window.demoSetYear = (y) => {
  for (const t of timelines) t.setValue(y);
  show(timeline.getValue());
};

// Highlight buttons: lifespans from the dataset's polity index when available.
const findPolity = (name) => {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const exact = polities.find(([, p]) => p.name?.toLowerCase() === q);
  const hit = exact ?? polities.find(([, p]) => p.name?.toLowerCase().includes(q));
  return hit ? { name: hit[1].name, spans: hit[1].spans } : FALLBACK_SPANS[name] ? { name, spans: FALLBACK_SPANS[name] } : null;
};
const buttons = [];
const select = (btn, polity) => {
  for (const b of buttons) b.setAttribute('aria-pressed', String(b === btn));
  for (const t of timelines) t.setHighlight(polity ? polity.spans.map(([from, to]) => ({ from, to })) : null);
  log(polity ? `highlight ${polity.name} ${fmtSpan(polity.spans)}` : 'highlight none');
};
for (const name of [...QUICK, null]) {
  const polity = name ? findPolity(name) : null;
  if (name && !polity) continue;
  const btn = document.createElement('button');
  btn.className = 'demo-button';
  btn.type = 'button';
  btn.textContent = polity ? polity.name : 'None';
  btn.title = polity ? fmtSpan(polity.spans) : 'Remove the highlight';
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => select(btn, polity));
  buttons.push(btn);
  $('demo-highlights').append(btn);
}
const search = () => {
  const polity = findPolity($('demo-search').value);
  if (polity) select(null, polity);
  else log(`no polity matches “${$('demo-search').value}”`);
};
$('demo-search-go').addEventListener('click', search);
$('demo-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search();
});

$('demo-frames').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  for (const t of timelines) t.setFrames(on ? datasetFrames : null);
});
$('demo-theme').addEventListener('click', (e) => {
  const light = document.body.classList.toggle('demo-light');
  e.currentTarget.setAttribute('aria-pressed', String(light));
});

$('demo-source').textContent = data
  ? `Border changes and lifespans: ${data.manifest.dataset} ${data.manifest.version} (${datasetFrames.length} change years, ${polities.length} polities).`
  : `Dataset not built: embedded Cliopatria change years (${datasetFrames.length}) and conventional lifespans.`;
