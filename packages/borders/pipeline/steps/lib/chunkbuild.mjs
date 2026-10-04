// Builds one chunk file at one LOD from its temp GeoJSON: mapshaper topology +
// simplification, contract post-processing, gzip size, and the per-frame alignment
// checks. Runs in the main thread (l0 while planning) or in a worker (l1, l2).
import { gzipSync } from 'node:zlib';
import * as topojson from 'topojson-client';
import { simplifyFileToTopology, finishChunkTopology, mergeCoincidentArcs, removeDuplicatePoints, dropSmallIslands, islandMinAreaKm2, SIMPLIFY, SNAP_DEGREES } from './topo.mjs';
import { frameTopologyStats, arcLengthsKm, offCoastStats, quantizationErrorKm } from './verify.mjs';
import { loadCoastIndex } from './coast-index.mjs';
import { geometryAreaKm2 } from './geo.mjs';

export const GZIP_LEVEL = 6; // what a typical static host / CDN uses; budgets are measured with it

/**
 * @param {{inputPath:string, lod:{id,toleranceM,quantization}, props:object[], bboxes:[number,[number,number,number,number]][], frames:number[], watch?:number[], microstates?:string[], coastCheck?:boolean}} task
 *   props: contract-ordered PolityProps of the chunk's records; bboxes: [id, bbox] for stand-ins;
 *   frames: the frame years inside the chunk (verified); watch: ids whose decoded area is reported;
 *   microstates: pids that keep every islet; coastCheck: run the off-coast (gap) check (default true).
 */
export async function buildChunkLod(task) {
  const t0 = Date.now();
  const propsById = new Map(task.props.map((p) => [p.id, p]));
  const bboxById = new Map(task.bboxes);
  // a year range without records (only possible with partial inputs) is an empty topology
  const topology = task.props.length
    ? await simplifyFileToTopology(task.inputPath, { layer: 'polities', toleranceM: task.lod.toleranceM, quantization: task.lod.quantization, sizeField: 'sz' })
    : { type: 'Topology', arcs: [], objects: { polities: { type: 'GeometryCollection', geometries: [] } } };
  removeDuplicatePoints(topology); // points that quantized onto one grid cell
  const mergedArcs = mergeCoincidentArcs(topology); // boundaries that became identical copies
  const collapsed = []; // unclaimed land that collapsed on the grid: left out of this file
  const standIns = finishChunkTopology(topology, 'polities', propsById, bboxById, collapsed); // joins each record's parts
  // islets of large records far below a pixel at this LOD (small polities keep every part)
  const islets = dropSmallIslands(topology, 'polities', islandMinAreaKm2(task.lod), (g) => g.properties.a < SIMPLIFY.archipelagoMaxAreaKm2 || task.microstates?.includes(g.properties.pid));
  const text = JSON.stringify(topology);
  const bytes = gzipSync(text, { level: GZIP_LEVEL }).length;

  // alignment per frame (tier 0): overlaps, exterior (coast + gaps) length, exterior off the coastline
  const lengths = arcLengthsKm(topology);
  const perFrame = task.frames.map((y) => ({ year: y, ...frameTopologyStats(topology, 'polities', y, lengths, true) }));
  const worst = perFrame.reduce((w, s) => (s.overlapKm > w.overlapKm ? s : w), perFrame[0]);
  const ext = perFrame.map((s) => s.exteriorKm);
  const verification = {
    frames: perFrame.length,
    mergedArcs,
    collapsedUnclaimed: collapsed.length,
    isletsDropped: islets.parts,
    isletsKm2: islets.km2,
    overlapKmMax: Math.round(worst.overlapKm * 10) / 10,
    overlapYear: worst.overlapKm > 0 ? worst.year : null,
    overlapPairs: worst.overlapKm > 0 ? worst.overlapPairs : [],
    exteriorKmMin: Math.round(Math.min(...ext)),
    exteriorKmMax: Math.round(Math.max(...ext)),
  };
  if (task.coastCheck !== false) {
    // stand-in rectangles are not coastline: skip their arcs
    const standInIds = new Set(standIns);
    const skipArcs = new Set(topology.objects.polities.geometries.filter((g) => standInIds.has(g.id)).flatMap((g) => g.arcs.flat(2)).map((a) => (a < 0 ? ~a : a)));
    // a correct coastal vertex is off the coastline only by quantization and snapping
    const thresholdKm = quantizationErrorKm(topology) + SNAP_DEGREES * 111.32 + 0.05;
    const off = offCoastStats(topology, perFrame, loadCoastIndex(), thresholdKm, { skipArcs });
    verification.offCoastThresholdKm = Math.round(thresholdKm * 1000) / 1000;
    verification.offCoastKmMax = off.offCoastKmMax;
    verification.offCoastYear = off.year;
    verification.offCoastWorst = off.worst;
  }

  // decoded areas of watched (small) features vs their source area
  const watched = [];
  if (task.watch?.length) {
    const ids = new Set(task.watch);
    const geoms = topology.objects.polities.geometries.filter((g) => ids.has(g.id));
    const fc = topojson.feature(topology, { type: 'GeometryCollection', geometries: geoms });
    for (const f of fc.features) {
      const p = f.properties;
      watched.push({ rid: p.rid, a: p.a, decoded: Math.round(geometryAreaKm2(f.geometry) * 1000) / 1000 });
    }
  }
  return { lod: task.lod.id, text, bytes, rawBytes: Buffer.byteLength(text), records: task.props.length, standIns, verification, watched, ms: Date.now() - t0 };
}
