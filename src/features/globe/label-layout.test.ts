import assert from 'node:assert/strict';
import test from 'node:test';
import { labelAreas, type Polygon } from './label-layout.ts';

const rect = (w: number, s: number, e: number, n: number): Polygon => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const nothing = () => ({ water: [], above: [] });
const inside = ([x, y]: number[], [w, s, e, n]: number[]) => x > w && x < e && y > s && y < n;

test('a label sits in the middle of a plain shape', () => {
  const [area] = labelAreas([rect(0, 0, 10, 10)], nothing);
  assert.ok(Math.abs(area.point[0] - 5) < 0.5 && Math.abs(area.point[1] - 5) < 0.5, String(area.point));
});

test('pieces cut along tile edges are one area', () => {
  const areas = labelAreas([rect(0, 0, 5, 10), rect(5, 0, 10, 10)], nothing);
  assert.equal(areas.length, 1);
  assert.ok(Math.abs(areas[0].point[0] - 5) < 0.5);
});

test('water inside a polity does not get the label (Hudson Bay)', () => {
  // The bay fills the middle and opens to the north; land is a U round it.
  const bay = rect(3, 3, 7, 11);
  const [area] = labelAreas([rect(0, 0, 10, 10)], () => ({ water: [bay], above: [] }));
  assert.ok(!inside(area.point, [3, 3, 7, 11]), String(area.point));
});

test('ground covered by a smaller polity is not the label spot, and a covered polity gets none', () => {
  const [area] = labelAreas([rect(0, 0, 10, 10)], () => ({ water: [], above: [rect(0, 0, 6, 10)] }));
  assert.ok(area.point[0] > 6, String(area.point));
  assert.deepEqual(labelAreas([rect(0, 0, 10, 10)], () => ({ water: [], above: [rect(-1, -1, 11, 11)] })), []);
});

test('separate areas come largest first, each with its share of a sub-unit', () => {
  const big = rect(0, 0, 20, 20), island = rect(40, 0, 42, 2);
  const areas = labelAreas([island, big], nothing);
  assert.equal(areas.length, 2);
  assert.ok(areas[0].area > areas[1].area);
  assert.ok(areas[0].share([rect(0, 0, 20, 18)]) > 0.85);
  assert.equal(areas[1].share([big]), 0);
});

test('an island the sea data misses still gets a label', () => {
  const [area] = labelAreas([rect(0, 0, 1, 1)], () => ({ water: [rect(-5, -5, 5, 5)], above: [] }));
  assert.ok(inside(area.point, [0, 0, 1, 1]));
});
