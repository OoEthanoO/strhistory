// Year → displayed border frame, with latest-wins coalescing.
//
// A "frame" is a range of years with identical borders (BordersClient.frameOf)
// at one level of detail. Rules (AGENTS.md §5.5):
//  - a year change only does work when the frame (or LOD) changes;
//  - one load+render runs at a time; requests arriving meanwhile only replace
//    the wanted target (latest wins), intermediate ones are dropped;
//  - data that went stale while loading is not rendered;
//  - the previous frame stays on screen until the new one has rendered
//    (`apply` resolves only then), and a failed load keeps it too.
// Pure logic: MapLibre and the network are injected, so it is unit-tested.

export interface FrameKey {
  from: number;
  to: number;
  lod: string;
}

export const sameFrame = (a: FrameKey | null | undefined, b: FrameKey | null | undefined): boolean =>
  !!a && !!b && a.from === b.from && a.to === b.to && a.lod === b.lod;

export const frameKeyString = (k: FrameKey): string => `${k.from}..${k.to}@${k.lod}`;

export interface FrameSchedulerDeps<D> {
  /** Years sharing identical borders with `year`. */
  frameOf(year: number): { from: number; to: number };
  /** Fetches/decodes the data of a frame (`year` is any year inside it). */
  load(key: FrameKey, year: number): Promise<D>;
  /** Shows the data; resolves once it has rendered. */
  apply(data: D, key: FrameKey, year: number): Promise<void>;
  /** The wanted year's frame is on screen. */
  onApplied?(year: number, key: FrameKey): void;
  /** Busy state changes (true while the wanted frame is not displayed yet). */
  onLoading?(loading: boolean): void;
  onError?(error: unknown, key: FrameKey, year: number): void;
}

export class FrameScheduler<D> {
  private wanted: FrameKey | null = null;
  private wantedYear = NaN;
  private shown: FrameKey | null = null;
  private shownYear = NaN;
  private running = false;
  private disposed = false;
  private waiters: (() => void)[] = [];
  private lastAppliedYear = NaN;

  constructor(private readonly deps: FrameSchedulerDeps<D>) {}

  /** Frame currently on screen (null before the first one rendered). */
  get displayed(): FrameKey | null {
    return this.shown;
  }

  /** Last requested year. */
  get year(): number {
    return this.wantedYear;
  }

  get busy(): boolean {
    return this.running;
  }

  /**
   * Asks for `year` at level of detail `lod`. Cheap when nothing changes; never
   * throws (errors go to `onError`). Resolve-on-render via {@link whenSettled}.
   */
  request(year: number, lod: string): void {
    if (this.disposed) return;
    const f = this.deps.frameOf(year);
    const key: FrameKey = { from: f.from, to: f.to, lod };
    this.wantedYear = year;
    this.wanted = key;
    if (this.running) return; // the running loop picks the new target up
    if (sameFrame(key, this.shown)) {
      this.shownYear = year;
      this.notifyApplied(year, key);
      this.release();
      return;
    }
    void this.run();
  }

  /** Resolves when no work is pending (the wanted frame is displayed, failed, or the scheduler was disposed). */
  whenSettled(): Promise<void> {
    if (!this.running || this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Forget the displayed frame so the next request reloads (e.g. after a style reset). */
  invalidate(): void {
    this.shown = null;
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  private notifyApplied(year: number, key: FrameKey): void {
    if (year === this.lastAppliedYear && sameFrame(key, this.shown) && !this.running) return;
    this.lastAppliedYear = year;
    this.deps.onApplied?.(year, key);
  }

  private release(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  private async run(): Promise<void> {
    this.running = true;
    this.deps.onLoading?.(true);
    try {
      while (!this.disposed && this.wanted && !sameFrame(this.wanted, this.shown)) {
        const key = this.wanted;
        const year = this.wantedYear;
        let data: D;
        try {
          data = await this.deps.load(key, year);
        } catch (err) {
          if (this.disposed) return;
          this.deps.onError?.(err, key, year);
          // Retrying immediately would loop on a persistent failure; stop unless a
          // different frame was requested meanwhile. A later request retries.
          if (sameFrame(this.wanted, key)) break;
          continue;
        }
        if (this.disposed) return;
        if (!sameFrame(this.wanted, key)) continue; // stale: never render it
        try {
          await this.deps.apply(data, key, year);
        } catch (err) {
          if (this.disposed) return;
          this.deps.onError?.(err, key, year);
          if (sameFrame(this.wanted, key)) break;
          continue;
        }
        if (this.disposed) return;
        this.shown = key;
        this.shownYear = year;
      }
    } finally {
      this.running = false;
      if (!this.disposed) {
        if (this.wanted && sameFrame(this.wanted, this.shown)) {
          this.shownYear = this.wantedYear;
          this.lastAppliedYear = NaN; // always report the settled year once
          this.notifyApplied(this.wantedYear, this.shown as FrameKey);
        }
        this.deps.onLoading?.(false);
      }
      this.release();
    }
  }
}
