// Source list, attribution strings (root AGENTS.md §6) and the licence/attribution
// documents written next to the dataset.
import { CONFIG } from './context.mjs';

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const CLIO = CONFIG.sources.cliopatria;
const NE = CONFIG.sources.naturalearth;
const PAPER_DOI = '10.1038/s41597-025-04516-9';

/** What we change in Cliopatria, per build flavour (part of its attribution). */
const CLIO_CHANGES = {
  final: 'leaf polities only, clipped to Natural Earth land, islands assigned, corrected by Alex’s Atlas overrides',
  dev: 'leaf polities only; development build, not yet clipped to land or corrected',
};

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;

/**
 * Manifest `sources` (root AGENTS.md §5.2/§6). `flavour` is 'final' or 'dev';
 * the override source is listed only when overrides contribute to the build.
 */
export function buildSources({ flavour = 'final', withOverrides = flavour === 'final', version }) {
  const clioChanges = CLIO_CHANGES[flavour];
  const sources = [
    {
      id: 'cliopatria',
      name: CLIO.name,
      version: CLIO.version,
      url: CLIO.homepage,
      license: CLIO.license,
      spdx: CLIO.spdx,
      attribution: `Historical borders: Cliopatria (Seshat Global History Databank), Bennett et al., Scientific Data 12, 247 (2025), doi:${PAPER_DOI}, CC BY 4.0 — modified (${clioChanges}).`,
      changes: clioChanges,
    },
    {
      id: 'naturalearth',
      name: NE.name,
      version: NE.version,
      url: NE.homepage,
      license: NE.license,
      spdx: NE.spdx,
      attribution: 'Made with Natural Earth.',
      changes: flavour === 'final'
        ? 'land and minor islands dissolved and used as the coastline that clips every polity; admin-0/admin-1 units assembled into yearly polities from 1946; lakes and land simplified per level of detail'
        : 'admin-0 countries used as they are today for every year from 1946; land, minor islands and lakes simplified per level of detail',
    },
  ];
  if (withOverrides) {
    sources.push({
      id: 'override',
      name: 'Alex’s Atlas overrides',
      version,
      url: 'packages/borders/AGENTS.md#5-override-catalog',
      license: 'CC BY 4.0',
      spdx: 'CC-BY-4.0',
      attribution: 'Alex’s Atlas overrides: sources listed per entry.',
      changes: 'manual, sourced fixes: missing polities, indigenous nations, corrected names and dates, island ownership, modern unit timelines',
    });
  }
  return sources;
}

/** Manifest `attribution` ({ text, html }) from the sources. */
export function buildAttribution(sources) {
  const text = sources.map((s) => s.attribution).join(' ');
  const html = sources
    .map((s) => {
      if (s.id === 'cliopatria') {
        return `Historical borders: ${link(s.url, 'Cliopatria')} (Seshat Global History Databank), Bennett et al., <i>Scientific Data</i> 12, 247 (2025), ${link(`https://doi.org/${PAPER_DOI}`, `doi:${PAPER_DOI}`)}, ${link(CC_BY, 'CC BY 4.0')} — modified (${esc(s.changes)}).`;
      }
      if (s.id === 'naturalearth') return `Made with ${link(s.url, 'Natural Earth')}.`;
      return esc(s.attribution);
    })
    .join(' ');
  return { text, html };
}

/** sources.json: the manifest sources plus pinning details for reproducibility. */
export function buildSourcesJson(sources) {
  return sources.map((s) => {
    if (s.id === 'cliopatria') {
      return { ...s, commit: CLIO.commit, download: CLIO.url, sha256: CLIO.sha256, doi: CLIO.doi, paper: CLIO.paper };
    }
    if (s.id === 'naturalearth') {
      return { ...s, download: NE.baseUrl, layers: Object.fromEntries(Object.entries(NE.layers).map(([k, v]) => [`${k}.geojson`, { sha256: v }])) };
    }
    return s;
  });
}

export function attributionMarkdown(manifest) {
  const lines = [
    '# Attribution',
    '',
    `Dataset \`${manifest.dataset}\` ${manifest.version}, built ${manifest.built}.`,
    '',
    'Use this credit line wherever the data is shown (the same text is in `manifest.json` → `attribution`):',
    '',
    `> ${manifest.attribution.text}`,
    '',
    '## Sources',
    '',
  ];
  for (const s of manifest.sources) {
    lines.push(`### ${s.name} (${s.version})`, '', `- URL: ${s.url}`, `- Licence: ${s.license} (SPDX \`${s.spdx}\`)`, `- Credit: ${s.attribution}`);
    if (s.changes) lines.push(`- Changes made: ${s.changes}`);
    if (s.id === 'cliopatria') lines.push(`- Paper: Bennett et al., *Scientific Data* 12, 247 (2025), https://doi.org/${PAPER_DOI}`, `- Dataset DOI: https://doi.org/${CLIO.doi}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function licenseMarkdown(manifest) {
  const rows = manifest.sources.map((s) => `| ${s.name} | ${s.version} | ${s.license} | ${s.changes ?? ''} |`);
  return [
    '# Licence',
    '',
    `The data files in this folder (\`manifest.json\`, \`chunks/\`, \`base/\`, \`polities.*.json\`, \`sources.json\`, \`qa-report.json\`) form the dataset \`${manifest.dataset}\` ${manifest.version}. They are licensed under the **Creative Commons Attribution 4.0 International** licence (CC BY 4.0).`,
    '',
    `- Summary: ${CC_BY}`,
    `- Legal code: ${CC_BY}legalcode`,
    '',
    'You may copy, redistribute and adapt the data for any purpose, including commercially, provided you give appropriate credit, provide a link to the licence and indicate if changes were made. Use the credit line in `ATTRIBUTION.md` (also `manifest.json` → `attribution.text` / `attribution.html`).',
    '',
    'The licence follows from Cliopatria (CC BY 4.0); Natural Earth is in the public domain and adds no conditions. The code of the `@alexs-atlas/borders` package is licensed separately (see its `package.json`).',
    '',
    '## Sources and changes made',
    '',
    '| Source | Version | Licence | Changes made by Alex’s Atlas |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'Geometry is simplified per level of detail (spherical Douglas–Peucker; tolerances in `manifest.json` → `lods`) and quantized as TopoJSON.',
    '',
    '## No warranty',
    '',
    'Historical borders are approximate and contested; the data is provided "as is", without warranty of any kind. Report errors via the override files described in `packages/borders/AGENTS.md`.',
    '',
  ].join('\n');
}
