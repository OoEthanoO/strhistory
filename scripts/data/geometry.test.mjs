import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { geoArea } from 'd3-geo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The override allows the same checks to demonstrate failures on an older build.
const SNAPSHOTS = process.env.BORDER_TEST_SNAPSHOT_DIR
  ? resolve(process.env.BORDER_TEST_SNAPSHOT_DIR)
  : join(ROOT, 'public/data/snapshots');
const EARTH_RADIUS_KM = 6371.0088;

// Spherical polygon areas measured from the unsimplified source geometry on
// 2026-09-26. These are fidelity references for the source map, NOT claims about
// countries' real-world areas: Natural Earth generalises even its microstates.
// Modern: nvkelso/natural-earth-vector/geojson/ne_10m_admin_0_countries_iso.geojson
// Historical: aourednik/historical-basemaps/geojson/world_1783.geojson
// Minimum vertices retain at least half the original outline; polygon/ring
// counts catch lost islands and enclaves, which total area alone can overlook.
const CASES = [
  { year: 2026, name: 'Belgium', area: 30561.517090274, vertices: 324, polygons: 1, rings: 1 },
  { year: 2026, name: 'Netherlands', area: 36957.736175292, vertices: 396, polygons: 9, rings: 9 },
  { year: 2026, name: 'Luxembourg', area: 2599.776450052, vertices: 99, polygons: 1, rings: 1 },
  { year: 2026, name: 'Switzerland', area: 41326.311122609, vertices: 375, polygons: 1, rings: 1 },
  { year: 2026, name: 'Monaco', area: 18.803487664, vertices: 6, polygons: 1, rings: 1 },
  { year: 2026, name: 'Liechtenstein', area: 136.876864229, vertices: 15, polygons: 1, rings: 1 },
  { year: 2026, name: 'Andorra', area: 451.502377750, vertices: 26, polygons: 1, rings: 1 },
  { year: 2026, name: 'San Marino', area: 60.197910413, vertices: 10, polygons: 1, rings: 1 },
  { year: 2026, name: 'Vatican City', area: 0.012187481, vertices: 4, polygons: 1, rings: 1 },
  { year: 2026, name: 'Malta', area: 325.644765101, vertices: 28, polygons: 2, rings: 2 },
  { year: 1783, name: 'Swiss Confederation', area: 33673.415650405, vertices: 104, polygons: 1, rings: 3 },
  { year: 1783, name: 'Geneva', area: 204.779908663, vertices: 7, polygons: 1, rings: 1 },
  { year: 1783, name: 'Luxembourg', area: 2697.532995817, vertices: 9, polygons: 1, rings: 1 },
  { year: 1783, name: 'Netherlands', area: 33002.565745028, vertices: 43, polygons: 1, rings: 1 },
];

const snapshots = new Map([...new Set(CASES.map(({ year }) => year))].map((year) =>
  [year, JSON.parse(readFileSync(join(SNAPSHOTS, `world_${year}.geojson`), 'utf8'))],
));
const polygonsOf = (geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
function ringArea(ring) {
  const area = geoArea({ type: 'Polygon', coordinates: [ring] });
  // Accept either GeoJSON or d3 winding while measuring the small enclosed area.
  return Math.min(area, 4 * Math.PI - area);
}

for (const expected of CASES) {
  test(`${expected.year} ${expected.name}: preserve source outline, islands and area`, () => {
    const features = snapshots.get(expected.year).features.filter((feature) =>
      feature.properties?.name === expected.name && /^(Multi)?Polygon$/.test(feature.geometry?.type),
    );
    assert.ok(features.length > 0, 'A named polygon must remain, not just its label point');
    const polygons = features.flatMap((feature) => polygonsOf(feature.geometry));
    const rings = polygons.flat();
    const vertexCount = rings.reduce((total, ring) => total + ring.length, 0);
    assert.ok(polygons.length >= expected.polygons, `Lost an island: ${polygons.length} polygons, expected at least ${expected.polygons}`);
    assert.ok(rings.length >= expected.rings, `Lost a boundary ring: ${rings.length}, expected at least ${expected.rings}`);
    assert.ok(vertexCount >= expected.vertices, `Over-simplified outline: ${vertexCount} vertices, expected at least ${expected.vertices}`);

    for (const ring of rings) {
      assert.ok(ring.length >= 4, 'Polygon rings need at least four coordinates');
      assert.deepEqual(ring[0], ring.at(-1), 'Polygon rings must be closed');
      assert.ok(new Set(ring.map((point) => point.join(','))).size >= 3, 'Polygon rings need three distinct vertices');
      assert.ok(ringArea(ring) > 0, 'Polygon rings must enclose an area');
      for (const [lng, lat] of ring) {
        assert.ok(Number.isFinite(lng) && lng >= -180 && lng <= 180, 'Invalid longitude');
        assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, 'Invalid latitude');
      }
    }

    const area = polygons.reduce((total, [outer, ...holes]) =>
      total + ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0), 0,
    ) * EARTH_RADIUS_KM ** 2;
    const error = Math.abs(area - expected.area) / expected.area;
    assert.ok(error <= 0.01, `Source area changed ${(100 * error).toFixed(3)}%; limit is 1%`);
  });
}

// Every snapshot, not just the fidelity cases above: the globe relies on these.
const GLYPH_RANGES = readdirSync(join(ROOT, 'public/glyphs/noto-sans'))
  .map((f) => f.match(/^(\d+)-(\d+)\.pbf$/))
  .filter(Boolean)
  .map((m) => [Number(m[1]), Number(m[2])]);
const drawable = (ch) => GLYPH_RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);

for (const file of readdirSync(SNAPSHOTS).filter((f) => /^world_-?\d+\.geojson$/.test(f))) {
  test(`${file}: drawable, coloured and labelled`, () => {
    const { features } = JSON.parse(readFileSync(join(SNAPSHOTS, file), 'utf8'));
    for (const { properties: p, geometry } of features) {
      assert.ok(geometry, `${p.name ?? 'An unnamed feature'} has no geometry`);
      if (p.kind === 'label') {
        const missing = [...p.name].filter((ch) => !drawable(ch));
        assert.deepEqual(missing, [], `Label "${p.name}" uses characters the map font lacks`);
      } else if (p.name && !p.disputed) {
        // Disputed areas without a single administrator are deliberately unattributed.
        assert.ok(p.power, `${p.name} has no power to colour it by`);
      }
    }
  });
}
