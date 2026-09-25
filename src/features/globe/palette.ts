/**
 * Polity colours. A polity's colour comes from hashing its controlling power
 * (SUBJECTO in the data), so an empire and its colonies share a colour and the
 * same power keeps its colour from one snapshot to the next.
 */

// Muted, mid-value tones that read well on the dark ocean and under white labels.
const PALETTE = [
  '#8c7a5b', '#7d8f69', '#6f8aa0', '#a0786f', '#8e7fa3', '#6f9a92', '#a38a5c', '#7a8fa8',
  '#9a7f8f', '#869a6c', '#a47f67', '#6d8795', '#958a6e', '#7f7896', '#8fa08a', '#a08470',
];

/** Land with no recorded polity. */
export const UNCLAIMED = '#3a3931';
export const OCEAN = '#0c1a2b';
export const LAND_BASE = '#34332c';

// A few powers get fixed colours so the most-studied empires are easy to tell
// apart in the 20th-century snapshots, where students look most often.
const FIXED: Record<string, string> = {
  'United Kingdom': '#b0806a',
  'United Kingdom of Great Britain and Ireland': '#b0806a',
  France: '#6f8fb0',
  Germany: '#8a8f6a',
  'German Empire': '#8a8f6a',
  'Russian Empire': '#a0707a',
  Russia: '#a0707a',
  USSR: '#b06b6b',
  'Soviet Russia': '#b06b6b',
  'United States': '#7e9f96',
  'United States of America': '#7e9f96',
  'Empire of Japan': '#b3935c',
  Japan: '#b3935c',
  China: '#9b8468',
  'Republic of China': '#9b8468',
  'Ottoman Empire': '#8f7fa6',
  Italy: '#7f9c74',
  'Kingdom of Italy': '#7f9c74',
  Spain: '#a88f63',
  Portugal: '#7c8fa0',
  Belgium: '#9a8a74',
  Netherlands: '#a08463',
};

export function colorFor(key: string | null | undefined): string {
  if (!key) return UNCLAIMED;
  const fixed = FIXED[key];
  if (fixed) return fixed;
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[(h >>> 0) % PALETTE.length];
}
