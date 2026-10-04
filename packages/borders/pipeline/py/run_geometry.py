"""Alex’s Atlas geometry build: pinned sources + override files -> the final,
coast-aligned feature set that the packaging step consumes (application order of
packages/borders/AGENTS.md section 4.1).

    node packages/borders/pipeline/tools/py.mjs run_geometry.py [--steps a,b,...] [--workers N]
                                                                [--years A..B] [--out DIR] [--no-overrides]

Steps (each caches its result under .cache/build/geom/; a step left out of --steps
reuses its cached result):
  normalise   Cliopatria leaf polities -> records (normalise.py)          geom/normalised.pkl
  overrides   overrides.apply_record_ops (delete, update, subtract, add)  geom/records.pkl
              + blockers for land the ops removed (blockers.py)
  clip        historical records + blockers clipped to land (clip.py)     geom/<tag>/hist.*
  modern      overrides.build_modern + blockers for unclaimed periods,    geom/<tag>/modern.*
              clipped to land
  frames      the coast step for every frame, consecutive identical       geom/<tag>/frames.pkl
              frames merged into runs (frames.py, coast.py)                 + geom/<tag>/frames/*.bin
  attributes  colours, ids, rids, polity index; writes the outputs        geom/<tag>/attributes.pkl
  qa          checks and report (qa.py); exit code 1 on a hard failure

<tag> is 'full', or 'y<A>_<B>' for a --years development subset (records outside the
range are dropped and the rest truncated to it).

Outputs (default .cache/build/final; .cache/build/final-<A>_<B> with --years):
  features.geojsonl  one GeoJSON Feature per line, properties = PolityProps (root
                     AGENTS.md section 5.2), unsimplified lon/lat, RFC 7946 winding.
                     Tier-0 features of a year (polities + unclaimed land) partition
                     Natural Earth 10m land. Unclaimed land is written per connected
                     polygon (pid 'none', merged over consecutive identical frames).
  frames.json        sorted change years
  polities.json      polity index
  qa-report.json, qa-summary.md, run-log.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import common as C
import geom as G

STEPS = ('normalise', 'overrides', 'clip', 'modern', 'frames', 'attributes', 'qa')
GEOM_DIR = os.path.join(C.BUILD, 'geom')


def say(msg: str) -> None:
    print(msg, flush=True)


def parse_years(s: str | None) -> tuple[int, int] | None:
    if not s:
        return None
    a, b = s.split('..')
    a, b = C.resolve_year(a.strip()), C.resolve_year(b.strip())
    if a == 0 or b == 0 or a > b:
        raise SystemExit(f'--years {s}: need A..B with A <= B and no year 0')
    return max(a, C.FIRST_YEAR), min(b, C.PRESENT_YEAR)


def clamp_years(recs: list[dict], years: tuple[int, int] | None) -> list[dict]:
    """Records alive in the range, truncated to it (dev subsets)."""
    if years is None:
        return recs
    a, b = years
    out = []
    for r in recs:
        if r['to'] < a or r['from'] > b:
            continue
        if r['from'] < a or r['to'] > b:
            r = dict(r, **{'from': max(r['from'], a), 'to': min(r['to'], b)})
        out.append(r)
    return out


def record_lookup(records: list[dict]):
    """ctx.record_lookup over source records: pid, year -> union of the tier-0 (else
    any) geometries alive then, or None."""
    by_pid: dict[str, list[dict]] = {}
    for r in records:
        by_pid.setdefault(r['pid'], []).append(r)

    def lookup(pid: str, year: int):
        hits = [r for r in by_pid.get(pid, ()) if r['from'] <= year <= r['to']]
        if not hits:
            return None
        base = [r for r in hits if int(r.get('tier') or 0) == 0] or hits
        return G.union([r['geometry'] for r in base])
    return lookup


def overrides_module(enabled: bool):
    """PG2's override engine, or None (disabled or not importable)."""
    if not enabled:
        say('[overrides] disabled (--no-overrides)')
        return None
    try:
        import overrides as O
        return O
    except Exception as ex:  # noqa: BLE001 - keep the build usable while PG2 works on it
        say(f'[overrides] cannot import overrides.py ({ex!r}); continuing without overrides')
        return None


def load_ov(O):
    if O is None:
        return None
    try:
        return O.load_overrides()
    except NotImplementedError as ex:
        say(f'[overrides] load_overrides not implemented ({ex}); continuing without overrides')
        return None


class Timer:
    def __init__(self):
        self.t0 = time.time()
        self.steps: dict[str, float] = {}

    def done(self, step: str, t: float) -> None:
        self.steps[step] = round(time.time() - t, 1)
        say(f'[geometry] {step} done in {self.steps[step]:.1f} s (total {time.time() - self.t0:.0f} s)')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Alex’s Atlas geometry build')
    ap.add_argument('--steps', help=f'comma-separated subset of {",".join(STEPS)} (default: all)')
    ap.add_argument('--workers', type=int, default=max(1, min(14, (os.cpu_count() or 4) - 2)))
    ap.add_argument('--years', help='development subset A..B (e.g. 1790..1810)')
    ap.add_argument('--out', help='output directory')
    ap.add_argument('--no-overrides', action='store_true', help='build without the override files')
    args = ap.parse_args(argv)
    steps = [s.strip() for s in args.steps.split(',')] if args.steps else list(STEPS)
    unknown = [s for s in steps if s not in STEPS]
    if unknown:
        raise SystemExit(f'unknown step(s) {unknown}; steps: {", ".join(STEPS)}')
    years = parse_years(args.years)
    tag = 'full' if years is None else f'y{years[0]}_{years[1]}'
    tdir = os.path.join(GEOM_DIR, tag)
    out_dir = args.out or (os.path.join(C.BUILD, 'final') if years is None
                           else os.path.join(C.BUILD, f'final-{years[0]}_{years[1]}'))
    rng = years or (C.FIRST_YEAR, C.PRESENT_YEAR)
    os.makedirs(tdir, exist_ok=True)
    timer = Timer()
    prev_timings = {}
    if set(steps) != set(STEPS) and os.path.exists(os.path.join(out_dir, 'run-log.json')):
        try:  # partial run: keep the timings of the steps run earlier
            with open(os.path.join(out_dir, 'run-log.json'), encoding='utf-8') as f:
                prev_timings = {k: v for k, v in json.load(f).get('timings', {}).items() if k not in steps}
        except (OSError, ValueError):
            pass
    say(f'[geometry] steps {",".join(steps)}; years {rng[0]}..{rng[1]}; {args.workers} worker(s); cache {tdir}')
    ctx = C.Ctx()
    O = overrides_module(not args.no_overrides)
    norm_path = os.path.join(GEOM_DIR, 'normalised.pkl')
    rec_path = os.path.join(GEOM_DIR, 'records.pkl' if O is not None else 'records-no-overrides.pkl')
    hist_prefix = os.path.join(tdir, 'hist')
    modern_prefix = os.path.join(tdir, 'modern')
    frames_path = os.path.join(tdir, 'frames.pkl')
    attr_path = os.path.join(tdir, 'attributes.pkl')

    # 1 normalise --------------------------------------------------------------------
    if 'normalise' in steps:
        import normalise
        t = time.time()
        C.save_pickle(norm_path, normalise.normalise(log=say))
        timer.done('normalise', t)

    # 2 record overrides + removal blockers ------------------------------------------
    if 'overrides' in steps:
        import blockers as B
        t = time.time()
        norm = C.load_pickle(norm_path)
        records = list(norm['records'])
        ov = load_ov(O)
        log, cy = [], []
        out = records
        if ov is not None:
            ctx.record_lookup = record_lookup(records)
            try:
                out, log = O.apply_record_ops(records, ov, ctx)
                cy = sorted(O.change_years(ov))
            except NotImplementedError as ex:
                say(f'[overrides] apply_record_ops not implemented ({ex}); records unchanged')
                out = records
            finally:
                ctx.record_lookup = None
        blk = B.removal_blockers(records, out)
        status = {}
        for e in log:
            status[e.get('status')] = status.get(e.get('status'), 0) + 1
        say(f'[overrides] {len(records)} -> {len(out)} records, {len(blk)} removal blocker(s); entries {status}')
        C.save_pickle(rec_path, {'records': out, 'blockers': blk, 'log': log, 'change_years': cy,
                                 'relations': norm.get('relations'), 'norm_log': norm.get('log'),
                                 'norm_stats': norm.get('stats')})
        del norm, records, out
        timer.done('overrides', t)

    # 3 clip historical records --------------------------------------------------------
    if 'clip' in steps:
        import clip
        import store as S
        t = time.time()
        data = C.load_pickle(rec_path)
        recs = clamp_years(data['records'] + data['blockers'], years)
        recs = [r for r in recs if r['from'] <= C.CUTOVER_YEAR - 1]
        recs, clog = clip.clip_records(recs, args.workers, log=say, label='clip')
        S.write_store(hist_prefix, recs, extra={'log': clog})
        del data, recs
        timer.done('clip', t)

    # 4 modern layer ---------------------------------------------------------------------
    if 'modern' in steps:
        import blockers as B
        import clip
        import store as S
        t = time.time()
        recs, clog, mlog = [], [], []
        if rng[1] >= C.CUTOVER_YEAR:
            ov = load_ov(O)
            if ov is not None:
                try:
                    mrec, mlog = O.build_modern(ov, ctx)
                    recs = mrec + B.modern_blockers(ov, ctx, O.resolve_geometry)
                except NotImplementedError as ex:
                    say(f'[modern] build_modern not implemented ({ex}); no modern layer')
            recs = clamp_years(recs, years)
            if recs:
                recs, clog = clip.clip_records(recs, args.workers, log=say, label='modern')
        n_blk = sum(1 for r in recs if r.get('kind') == 'unclaimed')
        say(f'[modern] {len(recs) - n_blk} records + {n_blk} unclaimed-period blocker(s)')
        S.write_store(modern_prefix, recs, extra={'log': clog, 'modern_log': mlog})
        timer.done('modern', t)

    # 5 frames: coast step + merge ---------------------------------------------------------
    if 'frames' in steps:
        import frames as F
        import land as Lnd
        import qa
        t = time.time()
        land = Lnd.Land()
        ri = qa.build_report_index(land, ctx)
        data = C.load_pickle(rec_path)
        costs_path = os.path.join(tdir, 'frame-costs.json')
        prior = {}
        if os.path.exists(costs_path):  # seconds per frame of the previous run: balances the blocks
            with open(costs_path, encoding='utf-8') as f:
                prior = {int(k): float(v) for k, v in json.load(f).items()}
        fres = F.run_frames([hist_prefix, modern_prefix], data['change_years'], args.workers,
                            out_dir=os.path.join(tdir, 'frames'), years=rng, samples=qa.sample_years(),
                            report_index=ri, overrides=O is not None, prior_costs=prior, log=say)
        del data
        C.save_pickle(frames_path, fres)
        with open(costs_path, 'w', encoding='utf-8') as f:
            json.dump({str(q['from']): q['secs'] for q in fres['frames_qa']}, f)
        timer.done('frames', t)

    # 6 attributes + outputs ---------------------------------------------------------------
    if 'attributes' in steps or 'qa' in steps:
        import attributes as A
        import frames as F
        import store as S
        view = S.MultiStore([hist_prefix, modern_prefix])
        metas = view.meta
        fres = C.load_pickle(frames_path)
        reader = F.RunReader(fres['paths'])

        def geom_of(p):
            return reader.geom(p['_run']) if '_run' in p else view.clipped(p['_tier1'])

    if 'attributes' in steps:
        t = time.time()
        tier1 = []
        for i, m in enumerate(metas):
            if int(m.get('tier') or 0) != 1 or m.get('kind') == 'unclaimed':
                continue
            g = view.clipped(i)
            if g is None or g.is_empty:
                continue
            lx, ly = F.label_point(g)
            tier1.append({'i': i, 'a': float(m.get('clip_area') or C.area_km2(g)), 'lx': lx, 'ly': ly,
                          'bbox': G.bbox_lonlat([g])})
        powers = sorted({m['power'] or m['pid'] for m in metas if m.get('kind') != 'unclaimed'})
        colours, colour_stats = A.colour_powers(fres['adjacency'], A.PALETTE, powers)
        feats = A.make_features(metas, fres['runs'], tier1, colours)
        os.makedirs(out_dir, exist_ok=True)
        wstats = A.write_features(os.path.join(out_dir, 'features.geojsonl'), feats, geom_of)
        A.write_json(os.path.join(out_dir, 'frames.json'), fres['frames'])
        A.write_json(os.path.join(out_dir, 'polities.json'), A.polity_index(feats, metas))
        C.save_pickle(attr_path, {'feats': feats, 'colour_stats': colour_stats, 'write': wstats})
        say(f"[attributes] {wstats['features']} features, {wstats['vertices']:,} vertices, "
            f"{wstats['bytes'] / 1e6:.1f} MB; colours: {colour_stats['powers']} powers, "
            f"{colour_stats['conflicts']} conflicts ({colour_stats['conflict_weight_share'] * 100:.3f} % of weight)")
        timer.done('attributes', t)

    # 7 QA ---------------------------------------------------------------------------------
    rc = 0
    if 'qa' in steps:
        import land as Lnd
        import qa
        t = time.time()
        ad = C.load_pickle(attr_path)
        data = C.load_pickle(rec_path)
        hist_log = view.stores[0].extra.get('log', [])
        mod_extra = view.stores[1].extra
        timings = {**prev_timings, **timer.steps}
        report = qa.run_qa(metas=metas, feats=ad['feats'], geom_of=geom_of, frames=fres['frames'], fres=fres,
                           clip_log=hist_log + mod_extra.get('log', []), override_log=data['log'],
                           modern_log=mod_extra.get('modern_log', []), land=Lnd.Land(), ctx=ctx,
                           colour_stats=ad['colour_stats'], timings=timings, years=rng,
                           extra={'output': ad.get('write'), 'frameStats': fres['stats']})
        A.write_json(os.path.join(out_dir, 'qa-report.json'), report, indent=1)
        with open(os.path.join(out_dir, 'qa-summary.md'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(qa.summary_markdown(report))
        failed = [c['check'] for c in report['checks'] if not c['ok']]
        say(f"[qa] {'PASSED' if not failed else 'FAILED: ' + ', '.join(failed)} -> {os.path.join(out_dir, 'qa-summary.md')}")
        timer.done('qa', t)
        rc = 1 if failed else 0
    if 'attributes' in steps or 'qa' in steps:
        reader.close()
        view.close()
    total = round(time.time() - timer.t0, 1)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'run-log.json'), 'w', encoding='utf-8') as f:
        json.dump({'steps': steps, 'years': list(rng), 'workers': args.workers, 'timings': {**prev_timings, **timer.steps},
                   'total': total, 'exit': rc}, f, indent=1)
    say(f'[geometry] finished in {total:.0f} s, exit code {rc}')
    return rc


if __name__ == '__main__':
    sys.exit(main())
