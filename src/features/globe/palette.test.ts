import assert from 'node:assert/strict';
import test from 'node:test';
import { colorFor, colorSchemeFor } from './palette.ts';

test('selects colour schemes by the inclusive border source year', () => {
  assert.equal(colorSchemeFor(1799).name, 'historical');
  assert.equal(colorSchemeFor(1800).name, 'nineteenth-century');
  assert.equal(colorSchemeFor(1899).name, 'nineteenth-century');
  assert.equal(colorSchemeFor(1900).name, 'modern');
  assert.equal(colorSchemeFor(2026).name, 'modern');
});

test('uses the current scheme when no border source year is supplied', () => {
  assert.equal(colorSchemeFor().name, 'modern');
});

test('applies converted source colours from 1900 onwards', () => {
  assert.notEqual(colorFor('France', 1899), '#3971e4');
  assert.equal(colorFor('France', 1900), '#3971e4');
  assert.equal(colorFor('France', 2026), '#3971e4');
  assert.equal(colorFor('United Kingdom', 1900), '#c9385d');
  assert.equal(colorFor('Japan', 1900), '#ffc9b3');
  assert.equal(colorFor('Mexico', 1900), '#689853');
  assert.equal(colorFor('Brazil', 1900), '#4c913f');
  assert.equal(colorFor('Iran', 1900), '#477161');
  assert.equal(colorFor('Persia', 1900), '#477161');
});

test('uses the supplied generic colours for unmatched modern polities', () => {
  const modernColors = colorSchemeFor(1900).colors;
  assert.ok(modernColors.includes(colorFor('A polity without a fixed colour', 1900)));
  assert.notEqual(colorFor('A polity without a fixed colour', 1899), colorFor('A polity without a fixed colour', 1900));
});
