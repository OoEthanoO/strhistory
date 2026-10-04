// Visual check of the timeline demo: renders demo.html headlessly in Microsoft Edge, or
// Google Chrome when Edge is not installed (playwright-core, SwiftShader; ALEXS_ATLAS_BROWSER
// picks another: ../../scripts/browser.mjs) at desktop and phone sizes, exercises hover, drag,
// keyboard focus, the typed-year error, playback, the light theme and forced colours,
// and writes .cache/screenshots/timeline-*.png. It also measures the rendered layout at
// 13 widths (320–2560 px): tick labels ≥ 56 px apart and not touching, nothing outside
// the timeline, no horizontal overflow, controls on one row, the typed-year field wide
// enough for "3400 BCE". The bar layout (demo.html?layout=bar: the site's options, with
// the typed year and with the year as a label) is checked at the same widths and on
// touch phones (44 px controls): one row in containers ≥ 640 px and two below (the track
// on top), controls in order without overlaps, all the same height, nothing outside the
// bar or the viewport, the year field/label wide enough for "3400 BCE", the track not
// moving as the year changes, the speed menu visible and wide enough for "0.5×", and the
// typed-year error above the bar and on screen; screenshots timeline-bar-*.png.
// Fails on any of those, on console or page errors, or on a request to another origin
// (root AGENTS.md §2.3).
//
//   node packages/globe/src/timeline/demo.screenshot.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from '../../scripts/browser.mjs'; // Edge, Chrome without Edge, or ALEXS_ATLAS_BROWSER

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const outDir = path.join(repoRoot, '.cache/screenshots');
mkdirSync(outDir, { recursive: true });

// Track position (0..1) of a year with the default stops (AGENTS.md §7.2).
const STOPS = [[-3400, 0], [-1200, 0.1], [-500, 0.16], [1, 0.22], [500, 0.3], [1000, 0.38], [1500, 0.5], [1800, 0.66], [1900, 0.8], [2026, 1]];
const astro = (y) => (y < 0 ? y + 1 : y);
function tOf(year) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [y0, t0] = STOPS[i];
    const [y1, t1] = STOPS[i + 1];
    if (year >= y0 && year <= y1) return t0 + ((astro(year) - astro(y0)) * (t1 - t0)) / (astro(y1) - astro(y0));
  }
  return year < STOPS[0][0] ? 0 : 1;
}

const server = await createServer({
  configFile: path.join(here, 'demo.vite.config.mjs'),
  server: { port: 0, strictPort: false },
  logLevel: 'warn',
});
await server.listen();
const base = server.resolvedUrls.local[0];
const url = new URL('demo.html', base).href;
const origin = new URL(base).origin;

const problems = [];
const shots = [];
const browser = await launchBrowser({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(name, options, { bar = false } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`[${name}] third-party request: ${u}`);
  });
  await page.goto(bar ? `${url}?layout=bar` : url, { waitUntil: 'networkidle' });
  if (bar) {
    // Both bars measured: their tick lines are drawn once the track has a width.
    await page.waitForFunction(() => {
      const roots = [...document.querySelectorAll('.ca-timeline[data-ca-layout="bar"]')];
      return roots.length === 2 && roots.every((r) => /^M/.test(r.querySelector('.ca-timeline__ticks-major')?.getAttribute('d') ?? ''));
    });
  } else {
    await page.waitForSelector('.ca-timeline__tick-label');
  }
  await page.evaluate(() => document.fonts.ready);
  return { page, context };
}

// Measures both bars of demo.html?layout=bar in the page (self-contained: it runs in the
// browser). Leaves the year at 3400 BCE, the longest year text.
function measureBars() {
  const issues = [];
  const bars = [];
  const roots = [...document.querySelectorAll('.ca-timeline[data-ca-layout="bar"]')];
  const box = (el) => el.getBoundingClientRect();
  // Rendered width of `text` in el's font, letter-spacing and figures included.
  const textWidth = (el, text) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    for (const p of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'font-variant-numeric', 'font-feature-settings', 'text-transform']) {
      probe.style.setProperty(p, cs.getPropertyValue(p));
    }
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' });
    probe.textContent = text;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const shown = (el) => {
    if (!el) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility !== 'visible' || Number(cs.opacity) === 0) return false;
    }
    const b = box(el);
    return b.width > 0 && b.height > 0;
  };
  // The track must not move as the year text changes.
  const tracks = (year) => {
    window.demoSetYear(year);
    return roots.map((r) => box(r.querySelector('.ca-timeline__scale')));
  };
  const at = [tracks(1453), tracks(2026), tracks(-3400)];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw) issues.push(`the page overflows by ${document.documentElement.scrollWidth - vw} px`);
  roots.forEach((root, r) => {
    const input = root.querySelector('.ca-timeline__year-input');
    const label = root.querySelector('.ca-timeline__year-label');
    const kind = input ? 'input' : 'label';
    const say = (msg) => issues.push(`${kind} bar: ${msg}`);
    const year = input ?? label;
    const scale = root.querySelector('.ca-timeline__scale');
    const speed = root.querySelector('.ca-timeline__speed-select');
    const buttons = [...root.querySelectorAll('.ca-timeline__transport .ca-timeline__btn')];
    if (buttons.length !== 3) say(`${buttons.length} transport buttons (want back, play, forward)`);
    const controls = [...buttons, year, scale, speed];
    const names = ['back', 'play', 'forward', 'year', 'track', 'speed'];
    const rb = box(root);
    controls.forEach((c, i) => {
      if (!shown(c)) say(`${names[i]} is not visible`);
    });
    // One row in containers of 640 px and more; below, two with the track alone on top.
    const centres = controls.map((c) => (box(c).top + box(c).bottom) / 2).sort((a, b) => a - b);
    let rows = 1;
    for (let i = 1; i < centres.length; i++) if (centres[i] - centres[i - 1] > 4) rows++;
    const want = rb.width >= 640 ? 1 : 2;
    if (rows !== want) say(`${rows} rows in a ${rb.width.toFixed(0)} px container (want ${want})`);
    const rest = controls.filter((c) => c !== scale);
    if (want === 2) {
      if (box(scale).bottom > Math.min(...rest.map((c) => box(c).top)) + 0.5) say('the track is not above the other controls');
      if (Math.abs(box(scale).width - rb.width) > 1) say(`the track is ${box(scale).width.toFixed(0)} px wide in a ${rb.width.toFixed(0)} px bar`);
    }
    // Left to right in DOM order (transport, year, track, speed), never overlapping.
    const line = want === 1 ? controls : rest;
    for (let i = 1; i < line.length; i++) {
      if (box(line[i]).left < box(line[i - 1]).right - 0.5) {
        say(`${names[controls.indexOf(line[i - 1])]} and ${names[controls.indexOf(line[i])]} overlap or are out of order`);
      }
    }
    const heights = controls.map((c) => box(c).height);
    if (Math.max(...heights) - Math.min(...heights) > 0.5) say(`controls differ in height (${heights.map((h) => h.toFixed(1)).join(', ')} px)`);
    // Nothing overflows the bar or the viewport.
    if (root.scrollWidth > root.clientWidth) say(`horizontal overflow ${root.scrollWidth - root.clientWidth} px`);
    if (rb.left < -0.5 || rb.right > vw + 0.5) say('the bar leaves the viewport');
    controls.forEach((c, i) => {
      const b = box(c);
      if (b.left < rb.left - 0.5 || b.right > rb.right + 0.5) say(`${names[i]} leaves the bar (${b.left.toFixed(1)}–${b.right.toFixed(1)} px, bar ${rb.left.toFixed(1)}–${rb.right.toFixed(1)} px)`);
    });
    // The track stays put whatever the year.
    const moved = Math.max(...at.map((a) => Math.max(Math.abs(a[r].left - at[0][r].left), Math.abs(a[r].width - at[0][r].width))));
    if (moved > 0.5) say(`the track moves ${moved.toFixed(1)} px as the year changes`);
    // The year shows "3400 BCE" (and every other year) in full.
    const shownYear = input ? input.value : label.textContent;
    if (shownYear !== '3400 BCE') say(`the year shows "${shownYear}" (want "3400 BCE")`);
    const ycs = getComputedStyle(year);
    const room = year.clientWidth - parseFloat(ycs.paddingLeft) - parseFloat(ycs.paddingRight);
    for (const text of ['3400 BCE', '1500 BCE', '2026']) {
      const need = textWidth(year, text);
      if (need > room + 0.5) say(`year ${kind} too narrow for "${text}" (${room.toFixed(1)} px < ${need.toFixed(1)} px)`);
    }
    if (label && label.scrollWidth > label.clientWidth) say(`year label clipped (${label.scrollWidth} > ${label.clientWidth} px)`);
    // The speed menu fits its longest entry.
    const scs = getComputedStyle(speed);
    const speedRoom = speed.clientWidth - parseFloat(scs.paddingLeft) - parseFloat(scs.paddingRight);
    const longest = Math.max(...[...speed.options].map((o) => textWidth(speed, o.textContent)));
    if (longest > speedRoom + 0.5) say(`speed menu too narrow (${speedRoom.toFixed(1)} px < ${longest.toFixed(1)} px)`);
    bars.push(`${kind}: ${rows} row${rows > 1 ? 's' : ''}, ${heights[0].toFixed(0)} px controls, track ${box(scale).width.toFixed(0)} px, year ${box(year).width.toFixed(0)} px`);
  });
  if (roots.length !== 2) issues.push(`${roots.length} bars (want 2)`);
  return { issues, bars, width: roots[0] ? Math.round(box(roots[0]).width) : 0 };
}

// Types an invalid year into the bar's typed-year field: the error must show above the
// bar, on screen (centred on the bar in compact containers, else on the field), and
// Escape must revert it.
async function checkBarYearError(page) {
  const issues = [];
  const field = page.locator('.ca-timeline[data-ca-layout="bar"] .ca-timeline__year-input');
  const before = await field.inputValue();
  await field.click();
  await page.keyboard.type('12345');
  await page.keyboard.press('Enter');
  const e = await page.evaluate(() => {
    const input = document.querySelector('.ca-timeline[data-ca-layout="bar"] .ca-timeline__year-input');
    const root = input.closest('.ca-timeline');
    const error = root.querySelector('.ca-timeline__year-error');
    const b = error.getBoundingClientRect();
    const rb = root.getBoundingClientRect();
    const yb = input.getBoundingClientRect();
    return {
      hidden: error.hidden,
      invalid: input.getAttribute('aria-invalid'),
      left: b.left,
      right: b.right,
      bottom: b.bottom,
      centre: (b.left + b.right) / 2,
      barTop: rb.top,
      barCentre: (rb.left + rb.right) / 2,
      fieldCentre: (yb.left + yb.right) / 2,
      compact: root.dataset.caCompact === 'true',
      vw: document.documentElement.clientWidth,
    };
  });
  if (e.hidden || e.invalid !== 'true') issues.push('typed-year error: not shown for "12345"');
  if (e.left < 0 || e.right > e.vw) issues.push(`typed-year error leaves the screen (${e.left.toFixed(1)}–${e.right.toFixed(1)} px of ${e.vw})`);
  if (e.bottom > e.barTop - 2) issues.push(`typed-year error is not above the bar (bottom ${e.bottom.toFixed(1)}, bar top ${e.barTop.toFixed(1)})`);
  const centre = e.compact ? e.barCentre : e.fieldCentre;
  if (Math.abs(e.centre - centre) > 1) issues.push(`typed-year error is off centre by ${(e.centre - centre).toFixed(1)} px (${e.compact ? 'bar' : 'field'})`);
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => {
    const input = document.querySelector('.ca-timeline[data-ca-layout="bar"] .ca-timeline__year-input');
    return { value: input.value, hidden: input.closest('.ca-timeline').querySelector('.ca-timeline__year-error').hidden };
  });
  if (!after.hidden || after.value !== before) issues.push(`Escape did not revert the typed year ("${after.value}", want "${before}")`);
  await field.blur();
  return issues;
}

async function checkBars(page, name) {
  const report = await page.evaluate(measureBars);
  for (const issue of report.issues) problems.push(`[${name}] ${issue}`);
  for (const issue of await checkBarYearError(page)) problems.push(`[${name}] ${issue}`);
  console.log(`${name.padEnd(17)} bar ${String(report.width).padStart(4)} px  ${report.bars.join('; ')}`);
}

async function shot(page, file, opts = {}) {
  const p = path.join(outDir, file);
  if (opts.element) await page.locator(opts.element).screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage: false });
  shots.push(p);
}

async function trackX(page, year) {
  const box = await page.locator('.ca-timeline__inner').boundingBox();
  return { x: box.x + tOf(year) * box.width, y: box.y + 19 };
}

try {
  // ---- desktop 1440 × 900 ------------------------------------------------------
  {
    const { page, context } = await open('desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.getByRole('button', { name: 'Ottoman Empire' }).click();
    await shot(page, 'timeline-desktop.png');

    // Hover readout over 1700 CE.
    const at1700 = await trackX(page, 1700);
    await page.mouse.move(at1700.x, at1700.y);
    await page.waitForTimeout(150);
    await shot(page, 'timeline-desktop-hover.png', { element: '.demo-dock' });

    // Keyboard: focus the slider, step to the next border changes.
    await page.mouse.move(700, 200);
    await page.focus('.ca-timeline__range');
    await page.keyboard.press(']');
    await page.keyboard.press(']');
    await page.waitForTimeout(200);
    await shot(page, 'timeline-desktop-focus.png', { element: '.demo-dock' });

    // Drag from the thumb towards 1900 and capture mid-drag.
    const value = await page.evaluate(() => window.demoTimeline.getValue());
    const from = await trackX(page, value);
    const to = await trackX(page, 1914);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(100);
    await shot(page, 'timeline-desktop-drag.png', { element: '.demo-dock' });
    await page.mouse.up();

    // Typed year: invalid input shows the error state.
    await page.locator('.ca-timeline__year-input').click();
    await page.keyboard.type('12345');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await shot(page, 'timeline-desktop-error.png');
    await page.keyboard.press('Escape');

    // Light theme through --ca-* custom properties.
    await page.getByRole('button', { name: 'Light theme' }).click();
    await page.getByRole('button', { name: 'Roman Empire' }).click();
    await page.evaluate(() => window.demoSetYear(117));
    await page.waitForTimeout(200);
    await shot(page, 'timeline-desktop-light.png');
    await context.close();
  }

  // ---- desktop detail at 2× ----------------------------------------------------
  {
    const { page, context } = await open('desktop-2x', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await page.getByRole('button', { name: 'Byzantine Empire' }).click();
    await page.evaluate(() => window.demoSetYear(1204));
    await page.waitForTimeout(200);
    await shot(page, 'timeline-desktop-2x-bar.png', { element: '.demo-dock' });
    await context.close();
  }

  // ---- forced colours (Windows high contrast) -----------------------------------
  {
    const { page, context } = await open('forced-colors', {
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      forcedColors: 'active',
    });
    await page.getByRole('button', { name: 'Ottoman Empire' }).click();
    await page.focus('.ca-timeline__range');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await shot(page, 'timeline-forced-colors-bar.png', { element: '.demo-dock' });
    await context.close();
  }

  // ---- bar layout, desktop (demo.html?layout=bar: below the site's bar with the typed
  // year, above it the same bar with the year as a label) ------------------------------
  {
    const { page, context } = await open('bar-desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, { bar: true });
    await page.getByRole('button', { name: 'Ottoman Empire' }).click();
    await page.evaluate(() => window.demoSetYear(1453));
    await page.waitForTimeout(200);
    await shot(page, 'timeline-bar-desktop.png', { element: '.demo-bars' });
    // Hover readout over the site's bar (the lower one), at 1700 CE.
    const track = await page.locator('#demo-timeline-bar .ca-timeline__inner').boundingBox();
    await page.mouse.move(track.x + tOf(1700) * track.width, track.y + track.height / 2);
    await page.waitForTimeout(150);
    await shot(page, 'timeline-bar-desktop-hover.png', { element: '.demo-bars' });
    await context.close();
  }

  // ---- real layout at many widths ---------------------------------------------------
  // Tick labels are placed from estimated widths; check the rendered result: labels at
  // least 56 px apart (centre to centre) without touching, inside the timeline, no
  // horizontal overflow, and the controls on one row.
  for (const width of [320, 360, 390, 414, 600, 639, 640, 768, 1024, 1280, 1440, 1920, 2560]) {
    const { page, context } = await open(`layout-${width}`, { viewport: { width, height: 700 } });
    const report = await page.evaluate(() => {
      const root = document.querySelector('.ca-timeline');
      const rb = root.getBoundingClientRect();
      const labels = [...root.querySelectorAll('.ca-timeline__tick-label')].map((l) => {
        const b = l.getBoundingClientRect();
        return { year: l.dataset.year, left: b.left, right: b.right };
      });
      const issues = [];
      for (let i = 1; i < labels.length; i++) {
        const a = labels[i - 1];
        const b = labels[i];
        const centres = (b.left + b.right) / 2 - (a.left + a.right) / 2;
        if (centres < 55.5) issues.push(`labels ${a.year} and ${b.year} are ${centres.toFixed(1)} px apart`);
        if (b.left - a.right < 2) issues.push(`labels ${a.year} and ${b.year} touch (${(b.left - a.right).toFixed(1)} px)`);
      }
      for (const l of labels) if (l.left < rb.left || l.right > rb.right) issues.push(`label ${l.year} leaves the timeline`);
      if (root.scrollWidth > root.clientWidth) issues.push(`horizontal overflow ${root.scrollWidth - root.clientWidth} px`);
      const shown = [...root.querySelector('.ca-timeline__controls').children].filter((c) => c.getBoundingClientRect().width > 0);
      const rows = new Set(shown.map((c) => Math.round(c.getBoundingClientRect().top / 20)));
      if (rows.size > 1) issues.push('controls wrap onto several rows');
      // The typed-year field must show the longest years in full ("3400 BCE").
      const input = root.querySelector('.ca-timeline__year-input');
      const cs = getComputedStyle(input);
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      for (const text of ['3400 BCE', '1500 BCE', '2026']) {
        const need = ctx.measureText(text).width;
        if (need > room) issues.push(`year field too narrow for "${text}" (${room.toFixed(0)} px < ${need.toFixed(0)} px)`);
      }
      return { issues, labels: labels.map((l) => l.year).join(' '), height: Math.round(rb.height) };
    });
    console.log(`${String(width).padStart(4)} px  height ${report.height}  labels ${report.labels}`);
    for (const issue of report.issues) problems.push(`[layout-${width}] ${issue}`);
    await context.close();

    const bar = await open(`bar-layout-${width}`, { viewport: { width, height: 700 } }, { bar: true });
    await checkBars(bar.page, `bar-layout-${width}`);
    await bar.context.close();
  }

  // ---- phones --------------------------------------------------------------------
  for (const [name, width, height] of [['phone', 390, 844], ['phone-360', 360, 740], ['phone-320', 320, 568]]) {
    const { page, context } = await open(name, {
      viewport: { width, height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.getByRole('button', { name: 'Ottoman Empire' }).tap();
    await shot(page, `timeline-${name}.png`);
    await shot(page, `timeline-${name}-bar.png`, { element: '.demo-dock' });
    if (name === 'phone') {
      await page.evaluate(() => window.demoSetYear(1800));
      await page.locator('.ca-timeline__btn--play').tap();
      await page.waitForTimeout(1500);
      await shot(page, 'timeline-phone-playing-bar.png', { element: '.demo-dock' });
      await page.locator('.ca-timeline__btn--play').tap();
    }
    await context.close();
  }

  // ---- bar layout on touch phones (44 px controls, as on the site) ------------------
  for (const [name, width, height] of [['bar-390', 390, 844], ['bar-360', 360, 740], ['bar-320', 320, 568]]) {
    const { page, context } = await open(
      name,
      { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
      { bar: true },
    );
    await page.getByRole('button', { name: 'Ottoman Empire' }).tap();
    await page.evaluate(() => window.demoSetYear(1453));
    await page.waitForTimeout(150);
    if (name !== 'bar-360') await shot(page, `timeline-${name}.png`, { element: '.demo-bars' });
    if (name === 'bar-390') {
      // The typed-year error floats centred above the whole bar.
      await page.locator('.ca-timeline__year-input').tap();
      await page.keyboard.type('12345');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      await shot(page, 'timeline-bar-390-error.png');
      await page.keyboard.press('Escape');
    }
    await checkBars(page, `${name}-touch`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

for (const s of shots) console.log(`wrote ${path.relative(repoRoot, s)}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('no console errors, no third-party requests');
}
