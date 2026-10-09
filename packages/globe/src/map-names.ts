// MapNames: the country names of the frame on screen, painted on a canvas over the map
// (names.ts sets them, name-arcs.ts finds their arcs). The canvas sits in MapLibre's
// canvas container right above the map's own canvas, so markers (the site's note pins)
// stay on top, and is repainted on every frame MapLibre renders, through the same
// camera, so names move with the map without lag.
import type { MultiPolygon, Polygon } from '@alexs-atlas/borders';
import type { Map as MlMap } from 'maplibre-gl';
import { landWater, nameArcs, otherLand, shortName, type LandWater, type NameArc, type OtherLandTest } from './name-arcs.js';
import {
  NAME_TYPE,
  angle,
  byRank,
  dot,
  facing,
  globeCamera,
  horizonAngle,
  layoutName,
  nameBlockers,
  projectPoint,
  pxPerRadian,
  readsTurned,
  rimAlpha,
  sizeAlpha,
  smoothstep,
  step,
  toLonLat,
  toVec,
  type NameGlyph,
  type NameMetrics,
  type PlacedName,
  type Vec3,
} from './names.js';
import type { PolityFeatureLike } from './types.js';

/** Letters are drawn from a font of this size (px), scaled to their size on the globe. */
const REF_PX = 64;
/** Font weight of the names. */
const WEIGHT = 600;
/** Time spent finding arcs per slice (ms) before yielding to the page. */
const SLICE_MS = 6;
/** How long to wait for the web font before setting names in a fallback (ms). */
const FONT_WAIT_MS = 3000;
/** Above this zoom MapLibre's globe turns into Web Mercator: names use MapLibre's own projection. */
const GLOBE_MAX_ZOOM = 10;
/** Records whose arcs and names are remembered (least recently used beyond it are dropped, never the frame's own). */
const MAX_RECORDS = 2000;
/** The reading direction is judged at a name's middle letter while it faces the viewer at least this squarely. */
const PROBE_FACING = 0.2;

export interface MapNamesOptions {
  /** CSS font family (a family name, or a list such as `"Newsreader Variable", serif`). Default `serif`. */
  font?: string;
  /** Names over land, and the letters of a name that lie over the sea or a lake. */
  ink: string;
  seaInk: string;
  /** Default true. */
  visible?: boolean;
  /** Lakes drawn over the land (in the sea's colour): names wait for them, then take the sea ink over them. */
  lakes?: Promise<readonly { geometry: Polygon | MultiPolygon | null }[]>;
  /** Font metrics to set names with instead of measuring `font` in the page (tests). */
  metrics?: NameMetrics;
}

/** A record to name. */
interface Candidate {
  key: string;
  pid: string;
  id: number;
  text: string;
  tier: number;
  area: number;
  geometry: PolityFeatureLike['geometry'];
}

/** What painting needs from a projection. */
interface Projector {
  project(p: Vec3, out: Float64Array, o: number): void;
  facing(p: Vec3): number;
  /** Screen px per radian at p. */
  scale(p: Vec3): number;
  /** View centre and the angle from it to the horizon (π: no horizon). */
  centre: Vec3;
  horizon: number;
  /** On a flat map: the point whose world copy (nearest the centre) the next name is drawn on, every point of it alike. */
  anchor?(p: Vec3): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A font family as given, quoted when it is one bare name with spaces. */
function fontFamily(font: string | undefined): string {
  const f = (font ?? '').trim();
  if (!f) return 'serif';
  return /[,"']/.test(f) || !/\s/.test(f) ? f : `"${f}"`;
}

/** Moves a key to the most recently used end of a Map (its insertion order). */
function touch<K, V>(m: Map<K, V>, k: K): V | undefined {
  const v = m.get(k);
  if (v !== undefined) {
    m.delete(k);
    m.set(k, v);
  }
  return v;
}

/** A polity's names of one text (`group` without its territory index). */
const ownerOf = (group: string): string => group.slice(0, group.lastIndexOf('\u0001'));

export class MapNames {
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly family: string;
  private ink: string;
  private seaInk: string;
  private visible: boolean;
  private metrics: NameMetrics | null = null;
  /** The names on the map, largest first, and for each the larger names it overlaps. */
  private names: PlacedName[] = [];
  private blockers: number[][] = [];
  /** By name group: when it arrived (it fades in) and whether it is drawn turned round. */
  private readonly born = new Map<string, number>();
  private readonly turned = new Map<string, boolean>();
  /** Arcs by record, and names by record and text (least recently used first). */
  private readonly arcs = new Map<string, NameArc[]>();
  private readonly layouts = new Map<string, PlacedName[]>();
  private candidates: Candidate[] = [];
  private signature = '';
  private queue: Candidate[] = [];
  private features: readonly PolityFeatureLike[] = [];
  private land: ((id: number) => OtherLandTest) | null = null;
  private water: LandWater | null = null;
  private lakes: readonly { geometry: Polygon | MultiPolygon | null }[] = [];
  private lakesReady: boolean;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private removed = false;
  private readonly buf = new Float64Array(10);
  private readonly ringBuf = new Float64Array(2);
  private eff = new Float32Array(0);
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly map: MlMap,
    opts: MapNamesOptions,
  ) {
    this.family = fontFamily(opts.font);
    this.ink = opts.ink;
    this.seaInk = opts.seaInk;
    this.visible = opts.visible !== false;
    try {
      const container = typeof map.getCanvasContainer === 'function' ? map.getCanvasContainer() : null;
      if (container && typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.className = 'ca-globe__names';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
        const mapCanvas = map.getCanvas();
        // Right above the map, below markers and popups added to the same container.
        if (mapCanvas.parentNode === container) container.insertBefore(canvas, mapCanvas.nextSibling);
        else container.appendChild(canvas);
        this.canvas = canvas;
      }
    } catch {
      /* no DOM (tests): names are set but never painted */
    }
    const sub = map.on('render', this.paint);
    this.cleanup.push(() => sub.unsubscribe());
    this.lakesReady = !opts.lakes;
    opts.lakes?.then(
      (lakes) => {
        this.lakes = lakes;
        this.water = null;
      },
      () => undefined,
    ).finally(() => {
      this.lakesReady = true;
      this.schedule();
    });
    if (opts.metrics) this.metrics = opts.metrics;
    else void this.loadMetrics();
  }

  /**
   * Names the polities of `features` (a frame at the coarsest LOD: its arcs stay the same
   * at every zoom): tier-0 and tier-1 records, in their short form ("Kingdom of France" →
   * "France") unless another polity of the frame shares it (both Congos keep their full
   * names), each territory it holds apart named on its own. Arcs are found a few at a
   * time, largest polities first, and cached by record; until a record's names are set,
   * its polity keeps the names it had (borders that moved do not blink its name out).
   */
  show(features: readonly PolityFeatureLike[]): void {
    if (this.removed) return;
    const named = features.filter((f) => {
      const p = f.properties;
      return p && p.kind !== 'unclaimed' && p.name?.trim() && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
    });
    const forms = new Map<string, Set<string>>();
    const formOf = (name: string): string => (shortName(name) ?? name).trim();
    for (const f of named) {
      const form = formOf(f.properties.name).toLocaleUpperCase('en-GB');
      const pids = forms.get(form) ?? new Set<string>();
      pids.add(f.properties.pid);
      forms.set(form, pids);
    }
    const candidates: Candidate[] = named
      .map((f) => {
        const p = f.properties;
        const short = formOf(p.name);
        const shared = (forms.get(short.toLocaleUpperCase('en-GB'))?.size ?? 0) > 1;
        return { key: p.rid, pid: p.pid, id: Number(p.id), text: shared ? p.name.trim() : short, tier: p.tier, area: p.a, geometry: f.geometry };
      })
      .sort((a, b) => b.area - a.area || (a.key < b.key ? -1 : 1));
    const signature = candidates.map((c) => `${c.key}\u0001${c.text}`).join('\u0002');
    this.features = features;
    this.land = null;
    this.water = null;
    if (signature === this.signature) return;
    this.signature = signature;
    this.candidates = candidates;
    // The frame's records are the most recently used (eviction drops the least recently used).
    for (const c of candidates) {
      touch(this.arcs, c.key);
      touch(this.layouts, this.layoutKey(c));
    }
    this.queue = candidates.filter((c) => !this.layouts.has(this.layoutKey(c)));
    this.publish();
    this.schedule();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.repaint();
  }

  setColors(ink: string, seaInk: string): void {
    if (ink === this.ink && seaInk === this.seaInk) return;
    this.ink = ink;
    this.seaInk = seaInk;
    this.repaint();
  }

  /** The names set for the frame (drawn or hidden), largest first (dev and tests). */
  placed(): readonly PlacedName[] {
    return this.names;
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const off of this.cleanup.splice(0)) off();
    this.canvas?.remove();
  }

  // ---- setting names ------------------------------------------------------------

  private layoutKey(c: Candidate): string {
    return `${c.key}\u0001${c.text}`;
  }

  /** Measures the font once it has loaded (or after FONT_WAIT_MS, then again when it arrives). */
  private async loadMetrics(): Promise<void> {
    const font = `${WEIGHT} ${REF_PX}px ${this.family}`;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    const loaded = fonts ? fonts.load(font, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').catch(() => []) : Promise.resolve([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = await Promise.race([
      loaded.then(() => false),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), FONT_WAIT_MS))),
    ]);
    clearTimeout(timer);
    if (this.removed) return;
    this.setMetrics(this.measure(font));
    if (late) {
      await loaded;
      if (!this.removed) this.setMetrics(this.measure(font));
    }
  }

  private measure(font: string): NameMetrics | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    ctx.font = font;
    const widths = new Map<string, number>();
    const c = ctx;
    const advance = (ch: string): number => {
      let w = widths.get(ch);
      if (w === undefined) {
        w = c.measureText(ch).width / REF_PX;
        widths.set(ch, w);
      }
      return w;
    };
    const cap = ctx.measureText('H').actualBoundingBoxAscent;
    return { advance, capHeight: cap > 0 ? cap / REF_PX : 0.68 };
  }

  private setMetrics(m: NameMetrics | null): void {
    if (!m) return;
    const old = this.metrics;
    if (old && [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].every((ch) => Math.abs(old.advance(ch) - m.advance(ch)) < 1e-4)) return;
    this.metrics = m;
    this.layouts.clear();
    this.queue = [...this.candidates];
    this.publish();
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.removed || !this.queue.length || !this.metrics || !this.lakesReady) return;
    this.timer = setTimeout(this.pump, 0);
  }

  /** Finds arcs and sets names for SLICE_MS, largest polities first, then shows what is ready. */
  private readonly pump = (): void => {
    this.timer = 0;
    if (this.removed || !this.metrics) return;
    const t0 = now();
    let done = 0;
    while (this.queue.length && (done === 0 || now() - t0 < SLICE_MS)) {
      this.work(this.queue.shift()!);
      done++;
    }
    this.publish();
    this.schedule();
  };

  private work(c: Candidate): void {
    let arcs = touch(this.arcs, c.key);
    if (arcs === undefined) {
      try {
        arcs = nameArcs(c.geometry as Polygon | MultiPolygon, this.landTest()(c.id));
      } catch {
        arcs = [];
      }
      this.arcs.set(c.key, arcs);
    }
    const key = this.layoutKey(c);
    if (touch(this.layouts, key) || !this.metrics) return;
    const metrics = this.metrics;
    const water = this.waterTest();
    const placed: PlacedName[] = [];
    arcs.forEach((arc, i) => {
      const n = layoutName(i ? `${c.key}#${i}` : c.key, c.text, c.tier, arc, metrics, water);
      if (n) placed.push({ ...n, group: `${c.pid}\u0001${c.text}\u0001${i}` });
    });
    this.layouts.set(key, placed);
  }

  /** Tier-0 land of the frame, but a given record's. */
  private landTest(): (id: number) => OtherLandTest {
    this.land ??= otherLand(this.polygons());
    return this.land;
  }

  /** The frame's land and the lakes, for the ink. */
  private waterTest(): LandWater {
    this.water ??= landWater(this.polygons(), this.lakes);
    return this.water;
  }

  private polygons(): { id: number; tier: number; geometry: Polygon | MultiPolygon }[] {
    return this.features.flatMap((f) =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon' ? [{ id: Number(f.properties.id), tier: f.properties.tier, geometry: f.geometry }] : [],
    );
  }

  /**
   * Puts the names that are set on the map, largest first, with the larger names each
   * overlaps. A record whose names are not set yet shows its polity's names from before.
   */
  private publish(): void {
    const before = new Map<string, PlacedName[]>();
    for (const n of this.names) {
      const owner = ownerOf(n.group);
      const list = before.get(owner);
      if (list) list.push(n);
      else before.set(owner, [n]);
    }
    const seen = new Set<string>();
    const list: PlacedName[] = [];
    for (const c of this.candidates) {
      const names = this.layouts.get(this.layoutKey(c)) ?? before.get(`${c.pid}\u0001${c.text}`) ?? [];
      for (const n of names) {
        if (seen.has(n.group)) continue;
        seen.add(n.group);
        list.push(n);
      }
    }
    list.sort(byRank);
    const t = now();
    for (const k of [...this.born.keys()]) if (!seen.has(k)) this.born.delete(k);
    for (const k of [...this.turned.keys()]) if (!seen.has(k)) this.turned.delete(k);
    for (const n of list) if (!this.born.has(n.group)) this.born.set(n.group, t);
    this.names = list;
    this.blockers = this.metrics ? nameBlockers(list, this.metrics.capHeight) : [];
    this.evict();
    this.repaint();
  }

  /** Drops the least recently used records beyond MAX_RECORDS, never those of the frame. */
  private evict(): void {
    if (this.arcs.size <= MAX_RECORDS && this.layouts.size <= MAX_RECORDS) return;
    const keep = new Set(this.candidates.flatMap((c) => [c.key, this.layoutKey(c)]));
    for (const cache of [this.arcs, this.layouts] as Map<string, unknown>[]) {
      for (const k of cache.keys()) {
        if (cache.size <= MAX_RECORDS) break;
        if (!keep.has(k)) cache.delete(k);
      }
    }
  }

  private repaint(): void {
    try {
      this.map.triggerRepaint();
    } catch {
      /* map gone */
    }
  }

  // ---- painting -----------------------------------------------------------------

  /**
   * The globe's camera (MapLibre's unrotated, untilted globe below GLOBE_MAX_ZOOM), else
   * MapLibre's own projection: on a globe with a point in sight when unprojecting its
   * screen position finds it again, on a flat map at the world copy nearest the centre.
   */
  private projector(width: number, height: number): Projector {
    const map = this.map;
    const zoom = map.getZoom();
    const c = map.getCenter();
    const type = (map.getProjection?.() as { type?: unknown } | undefined)?.type;
    const sphere = type === 'globe' || type === 'vertical-perspective';
    const level = [map.getBearing?.(), map.getPitch?.(), map.getRoll?.()].every((v) => !v || Math.abs(v) < 1e-6);
    if (sphere && level && (type === 'vertical-perspective' || zoom < GLOBE_MAX_ZOOM)) {
      const cam = globeCamera({
        lon: c.lng,
        lat: c.lat,
        zoom,
        fovY: typeof map.getVerticalFieldOfView === 'function' ? map.getVerticalFieldOfView() : 36.87,
        width,
        height,
        padding: map.getPadding?.(),
      });
      return {
        project: (p, out, o) => projectPoint(cam, p, out, o),
        facing: (p) => facing(cam, p),
        scale: (p) => pxPerRadian(cam, p),
        centre: cam.c,
        horizon: horizonAngle(cam),
      };
    }
    // A flat map draws each name whole on one world copy: every point of it is unwrapped
    // against the name's anchor (the copy of its middle nearest the centre), so a name at
    // the copies' seam is not torn apart, its letters smeared across the world.
    const copies = !sphere && (typeof map.getRenderWorldCopies === 'function' ? map.getRenderWorldCopies() : true);
    let anchor = c.lng;
    const at = (lon: number, lat: number): { x: number; y: number } => map.project([copies ? lon + 360 * Math.round((anchor - lon) / 360) : lon, lat]);
    const DEG = 0.01;
    return {
      project: (p, out, o) => {
        const q = at(...toLonLat(p));
        out[o] = q.x;
        out[o + 1] = q.y;
      },
      facing: sphere
        ? (p) => {
            const q = at(...toLonLat(p));
            const back = map.unproject([q.x, q.y]);
            return angle(toVec(back.lng, back.lat), p) < 1e-3 ? 1 : 0;
          }
        : () => 1,
      scale: (p) => {
        const [lon, lat] = toLonLat(p);
        const a = at(lon, lat);
        const b = at(lon, Math.min(89, lat + DEG));
        return Math.hypot(b.x - a.x, b.y - a.y) / ((DEG * Math.PI) / 180);
      },
      centre: toVec(c.lng, c.lat),
      horizon: Math.PI,
      anchor: (p) => {
        const lon = toLonLat(p)[0];
        anchor = lon + 360 * Math.round((c.lng - lon) / 360);
      },
    };
  }

  private readonly paint = (): void => {
    const canvas = this.canvas;
    if (!canvas || this.removed) return;
    let w = 0;
    let h = 0;
    try {
      const mc = this.map.getCanvas();
      w = mc.clientWidth;
      h = mc.clientHeight;
    } catch {
      return;
    }
    const dpr = (typeof this.map.getPixelRatio === 'function' ? this.map.getPixelRatio() : 0) || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    // The CSS size on its own: browser zoom changes it and the pixel ratio together.
    if (canvas.style.width !== `${w}px` || canvas.style.height !== `${h}px`) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const metrics = this.metrics;
    if (!this.visible || !metrics || !this.names.length || !(w > 0 && h > 0)) return;
    const P = this.projector(w, h);
    ctx.font = `${WEIGHT} ${REF_PX}px ${this.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const baseline = (metrics.capHeight * REF_PX) / 2;
    const viewMin = Math.min(w, h);
    const out = this.buf;
    const names = this.names;
    if (this.eff.length < names.length) this.eff = new Float32Array(names.length * 2);
    const eff = this.eff;
    const t = now();
    let fading = false;
    let fill = '';
    for (let i = 0; i < names.length; i++) {
      eff[i] = 0;
      const nm = names[i]!;
      if (angle(nm.mid, P.centre) > P.horizon + nm.radius) continue; // behind the globe
      P.anchor?.(nm.mid);
      let a = sizeAlpha(nm.em * P.scale(nm.mid), viewMin);
      if (a <= 0) continue;
      const age = (t - (this.born.get(nm.group) ?? t)) / NAME_TYPE.fadeMs;
      if (age < 1) {
        a *= smoothstep(0, 1, age);
        fading = true;
      }
      for (const j of this.blockers[i] ?? []) a *= 1 - eff[j]!;
      if (a < 0.01) continue;
      eff[i] = a;
      const turned = this.readsTurned(nm, P);
      const hstep = nm.em / 2;
      for (const g of turned ? nm.turned : nm.glyphs) {
        const ra = rimAlpha(P.facing(g.p));
        if (ra <= 0) continue;
        P.project(g.p, out, 0);
        const reach = 2 * nm.em * P.scale(g.p);
        if (out[0]! < -reach || out[0]! > w + reach || out[1]! < -reach || out[1]! > h + reach) continue;
        // The projection at the letter, by central differences over one em: screen px per
        // REF_PX along the reading direction and downward (−up).
        P.project(step(g.p, g.t, hstep), out, 2);
        P.project(step(g.p, g.t, -hstep), out, 4);
        P.project(step(g.p, g.u, hstep), out, 6);
        P.project(step(g.p, g.u, -hstep), out, 8);
        const k = dpr / REF_PX;
        const m: [number, number, number, number, number, number] = [
          (out[2]! - out[4]!) * k,
          (out[3]! - out[5]!) * k,
          (out[8]! - out[6]!) * k,
          (out[9]! - out[7]!) * k,
          out[0]! * dpr,
          out[1]! * dpr,
        ];
        ctx.globalAlpha = a * ra;
        if (g.shore) {
          this.drawAcrossShore(ctx, P, g, m, baseline, dpr);
          fill = ''; // restored by the clip's save/restore
          continue;
        }
        const style = g.sea ? this.seaInk : this.ink;
        if (style !== fill) {
          ctx.fillStyle = style;
          fill = style;
        }
        ctx.setTransform(...m);
        ctx.fillText(g.ch, 0, baseline);
      }
    }
    ctx.globalAlpha = 1;
    if (fading) this.repaint();
  };

  /**
   * Whether a name is drawn turned round, judged at its middle letter (the same point
   * wherever the view is, so a curved name does not flip as the map pans), or at the
   * letter nearest the view centre while the middle is near or behind the rim.
   */
  private readsTurned(nm: PlacedName, P: Projector): boolean {
    let probe = nm.glyphs[Math.floor((nm.glyphs.length - 1) / 2)]!;
    if (P.facing(probe.p) < PROBE_FACING) {
      for (const g of nm.glyphs) if (dot(g.p, P.centre) > dot(probe.p, P.centre)) probe = g;
    }
    const out = this.buf;
    P.project(probe.p, out, 0);
    P.project(step(probe.p, probe.t, nm.em), out, 2);
    const was = this.turned.get(nm.group) ?? false;
    const turned = readsTurned(out[0]!, out[1]!, out[2]!, out[3]!, was);
    if (turned !== was) this.turned.set(nm.group, turned);
    return turned;
  }

  /** A letter across a shore: the land ink clipped to the land around it, the sea ink to the rest. */
  private drawAcrossShore(ctx: CanvasRenderingContext2D, P: Projector, g: NameGlyph, m: [number, number, number, number, number, number], baseline: number, dpr: number): void {
    const land = new Path2D();
    const q = this.ringBuf;
    for (const ring of g.shore!) {
      ring.forEach((v, i) => {
        P.project(v, q, 0);
        if (i === 0) land.moveTo(q[0]!, q[1]!);
        else land.lineTo(q[0]!, q[1]!);
      });
      land.closePath();
    }
    const sea = new Path2D();
    sea.rect(-1e5, -1e5, 2e5, 2e5);
    sea.addPath(land);
    for (const [clip, style] of [
      [land, this.ink],
      [sea, this.seaInk],
    ] as const) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clip(clip, 'evenodd');
      ctx.setTransform(...m);
      ctx.fillStyle = style;
      ctx.fillText(g.ch, 0, baseline);
      ctx.restore();
    }
  }
}
