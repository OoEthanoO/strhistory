import assert from 'node:assert/strict';
import test from 'node:test';
import { pinClusters } from './pin-layout.ts';

test('overlapping pins collapse into one counted pin; isolated pins stand alone', () => {
  const clusters = pinClusters([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 105, y: 101 }, { id: 'c', x: 400, y: 400 }]);
  assert.deepEqual(clusters.get('a'), { leader: 'a', count: 2 });
  assert.deepEqual(clusters.get('b'), { leader: 'a', count: 2 });
  assert.deepEqual(clusters.get('c'), { leader: 'c', count: 1 });
});

test('a group never reaches beyond its radius from the leader', () => {
  // A chain of pins 15px apart must not merge into one group across the screen.
  const chain = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: i * 15, y: 0 }));
  const clusters = pinClusters(chain, 18);
  for (const point of chain) {
    const leader = chain.find((p) => p.id === clusters.get(point.id)!.leader)!;
    assert.ok(Math.abs(point.x - leader.x) < 18);
  }
});

test('a preferred pin (the selected note) leads its group; order is otherwise stable', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 100 }];
  assert.equal(pinClusters(points, 18, ['b']).get('a')!.leader, 'b');
  assert.deepEqual(pinClusters(points), pinClusters([...points].reverse()));
});
