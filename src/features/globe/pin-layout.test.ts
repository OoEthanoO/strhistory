import assert from 'node:assert/strict';
import test from 'node:test';
import { pinOffsets } from './pin-layout.ts';

test('overlapping event pins get distinct targets while isolated pins stay on their location', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 101, y: 101 }, { id: 'c', x: 400, y: 400 }];
  const offsets = pinOffsets(points);
  assert.deepEqual(offsets.get('c'), [0, 0]);
  const [ax, ay] = offsets.get('a')!;
  const [bx, by] = offsets.get('b')!;
  assert.ok(Math.hypot(100 + ax - 101 - bx, 100 + ay - 101 - by) >= 28);
});

test('pin offset order is stable for identical input locations', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 100 }];
  assert.deepEqual(pinOffsets(points), pinOffsets([...points].reverse()));
});
