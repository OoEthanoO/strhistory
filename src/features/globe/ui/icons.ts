// Stroke icons for the globe's UI (24×24, round caps; styled by .icon in atlas.css).
// Each entry is a list of SVG path `d` strings. Ported from the Alex's Atlas reference
// site, apps/site/src/ui/icons.ts, with three icons added for the history notes in the
// same style: `notes` (an open book), `locate` (a crosshair) and `pin` (a map pin).
export const ICONS = {
  search: ['M10.5 4.25a6.25 6.25 0 1 1 0 12.5a6.25 6.25 0 0 1 0-12.5z', 'M15.2 15.2L20 20'],
  list: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  info: ['M12 3.25a8.75 8.75 0 1 1 0 17.5a8.75 8.75 0 0 1 0-17.5z', 'M12 11v5.5', 'M12 7.75h.01'],
  link: [
    'M10.2 13.8a3.9 3.9 0 0 0 5.5 0l3.1-3.1a3.9 3.9 0 0 0-5.5-5.5l-1.3 1.3',
    'M13.8 10.2a3.9 3.9 0 0 0-5.5 0l-3.1 3.1a3.9 3.9 0 0 0 5.5 5.5l1.3-1.3',
  ],
  compare: ['M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z', 'M12 4.5v15', 'M6.5 9h3', 'M14.5 9h3', 'M6.5 12.5h2', 'M14.5 12.5h2'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  minus: ['M5.5 12h13'],
  globe: [
    'M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 0 1 0-17z',
    'M3.5 12h17',
    'M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z',
  ],
  fit: ['M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9', 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9', 'M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15', 'M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15', 'M9.5 12h5', 'M12 9.5v5'],
  copy: ['M9.5 8.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 8 18v-8a1.5 1.5 0 0 1 1.5-1.5z', 'M16 8.5V6a1.5 1.5 0 0 0-1.5-1.5h-8A1.5 1.5 0 0 0 5 6v8a1.5 1.5 0 0 0 1.5 1.5H8'],
  external: ['M13.5 4.5H19.5V10.5', 'M19.5 4.5l-8.5 8.5', 'M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4'],
  chevronUp: ['M6.5 14.5l5.5-5.5 5.5 5.5'],
  chevronDown: ['M6.5 9.5l5.5 5.5 5.5-5.5'],
  layers: ['M12 4l8.5 4.5L12 13 3.5 8.5z', 'M3.5 12.5L12 17l8.5-4.5', 'M3.5 16.25L12 20.75l8.5-4.5'],
  keyboard: ['M4.5 6.5h15a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5z', 'M7 10h.01', 'M10.5 10h.01', 'M14 10h.01', 'M17.5 10h.01', 'M8 14h8'],
  arrowLeft: ['M19 12H5.5', 'M11 6.5L5.5 12l5.5 5.5'],
  arrowRight: ['M5 12h13.5', 'M13 6.5l5.5 5.5-5.5 5.5'],
  check: ['M5.5 12.5l4 4 9-9'],
  alert: ['M12 4.5l8.5 15h-17z', 'M12 10v4', 'M12 16.75h.01'],
  sort: ['M8 5.5v13', 'M5 15.5l3 3 3-3', 'M16 18.5v-13', 'M13 8.5l3-3 3 3'],
  // An open book: two pages meeting at the spine.
  notes: [
    'M12 7.25c-2.4-1.55-5.2-2.15-8.5-1.75v12c3.3-.4 6.1.2 8.5 1.75z',
    'M12 7.25c2.4-1.55 5.2-2.15 8.5-1.75v12c-3.3-.4-6.1.2-8.5 1.75z',
  ],
  // A crosshair: a ring with four ticks and a centre dot.
  locate: ['M12 6a6 6 0 1 1 0 12a6 6 0 0 1 0-12z', 'M12 2.75V6', 'M12 18v3.25', 'M2.75 12H6', 'M18 12h3.25', 'M12 12h.01'],
  // A map pin with a hollow head.
  pin: ['M12 20.75c0 0-6.25-5.75-6.25-10.5a6.25 6.25 0 0 1 12.5 0c0 4.75-6.25 10.5-6.25 10.5z', 'M12 7.9a2.35 2.35 0 1 1 0 4.7a2.35 2.35 0 0 1 0-4.7z'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;
