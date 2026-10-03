// Inline SVG icons (20 × 20, currentColor). Static markup only, no external URLs.

const svg = (body: string): string =>
  `<svg class="ca-timeline__icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = Object.freeze({
  play: svg('<path fill="currentColor" d="M6.5 4.2v11.6a.7.7 0 0 0 1.06.6l9.1-5.8a.7.7 0 0 0 0-1.2l-9.1-5.8a.7.7 0 0 0-1.06.6z"/>'),
  pause: svg('<rect fill="currentColor" x="5" y="4.5" width="3.4" height="11" rx="1"/><rect fill="currentColor" x="11.6" y="4.5" width="3.4" height="11" rx="1"/>'),
  prevChange: svg(
    '<rect fill="currentColor" x="4" y="4.5" width="2.2" height="11" rx="1"/><path fill="currentColor" d="M15.5 5.1v9.8a.6.6 0 0 1-.93.5L7.9 10.5a.6.6 0 0 1 0-1l6.67-4.9a.6.6 0 0 1 .93.5z"/>',
  ),
  nextChange: svg(
    '<rect fill="currentColor" x="13.8" y="4.5" width="2.2" height="11" rx="1"/><path fill="currentColor" d="M4.5 5.1v9.8a.6.6 0 0 0 .93.5l6.67-4.9a.6.6 0 0 0 0-1L5.43 4.6a.6.6 0 0 0-.93.5z"/>',
  ),
  stepBack: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M12 5l-5 5 5 5"/>'),
  stepForward: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M8 5l5 5-5 5"/>'),
});
