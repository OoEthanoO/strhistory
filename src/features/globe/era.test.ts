import assert from 'node:assert/strict';
import test from 'node:test';
import { clampYear, formatRange, formatYear, indexOfYear, timelineX, topicInYear, yearAtTimelineX } from './era.ts';
import type { GlobeSnapshot } from './types';

test('event pins are visible only inside their inclusive date range', () => {
  const event = { start: 1789, end: 1789 };
  assert.equal(topicInYear(event, 1788), false);
  assert.equal(topicInYear(event, 1789), true);
  assert.equal(topicInYear(event, 1790), false);
  const period = { start: 1933, end: 1945 };
  assert.equal(topicInYear(period, 1933), true);
  assert.equal(topicInYear(period, 1938), true);
  assert.equal(topicInYear(period, 1945), true);
  assert.equal(topicInYear(period, 1946), false);
});

test('BCE dates and ranges use historical labels', () => {
  assert.equal(formatYear(-300000), '300000 BCE');
  assert.equal(formatRange(-500, -100), '500–100 BCE');
  assert.equal(formatRange(-1, 1), '1 BCE–1');
});

test('arbitrary selected years survive the timeline scale without snapping to maps', () => {
  const stops = [-300000, -10000, -3000, -1, 500, 1100, 1783, 1789, 1800, 1878, 2026];
  for (const year of [-299999, -12000, -2222, -500, -1, 1, 1756, 1789, 1861, 1933, 2026]) {
    assert.equal(yearAtTimelineX(stops, timelineX(stops, year)), year);
  }
});

test('year limits reach human prehistory and the supplied present without year zero', () => {
  assert.equal(clampYear(-400000, 2026), -300000);
  assert.equal(clampYear(2040, 2026), 2026);
  assert.equal(clampYear(0, 2026), 1);
  assert.equal(clampYear(1861, 2026), 1861);
});

test('context selects only a preceding snapshot and keeps its actual border year', () => {
  const snapshots: GlobeSnapshot[] = [
    { year: -10000, borderYear: null, title: '', summary: '', highlights: [] },
    { year: 1789, borderYear: 1783, title: '', summary: '', highlights: [] },
    { year: 1800, borderYear: 1800, title: '', summary: '', highlights: [] },
    { year: 2026, borderYear: null, title: '', summary: '', highlights: [] },
  ];
  assert.equal(indexOfYear(snapshots, -20000), -1);
  assert.equal(snapshots[indexOfYear(snapshots, -5000)].borderYear, null);
  assert.equal(snapshots[indexOfYear(snapshots, 1791)].borderYear, 1783);
  assert.equal(snapshots[indexOfYear(snapshots, 1800)].borderYear, 1800);
  assert.equal(snapshots[indexOfYear(snapshots, 2026)].borderYear, null);
});
