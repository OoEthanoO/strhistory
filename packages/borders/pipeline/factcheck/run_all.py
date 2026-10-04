"""Run the fact-check suite and print a one-screen summary.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/run_all.py [--tiles] [--tests] [--offline] [--only cliopatria,gaps,modern]

Steps (network, cached in .cache/wikidata — reruns are free):
  cliopatria  check_cliopatria.py  -> overrides/{historical,early}/auto-wikidata.json
  gaps        coverage_gaps.py     -> overrides/{historical,early}/auto-gaps.json
  modern      modern_autogen.py    -> overrides/modern/auto-wikidata.json (+ modern-crosscheck.md)
Optional: --tiles runs tile_qa.py on the built dataset, --tests the unit tests.
Afterwards every generated file is validated with validate-overrides.mjs (--file) and the
modern layer with --complete. Exit 1 if a step or a validation fails (tile-QA threshold
violations are reported but only fail the run with --strict-tiles).
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fcutil as U  # noqa: E402

STEPS = [('cliopatria', 'check_cliopatria.py'), ('gaps', 'coverage_gaps.py'), ('modern', 'modern_autogen.py')]
VALIDATOR = os.path.join(U.PIPELINE, 'tools', 'validate-overrides.mjs')


def sh(cmd: list[str]) -> tuple[int, str, float, str]:
    """(exit code, stdout, seconds, stderr): tools print results on stdout, progress on stderr."""
    t = time.time()
    p = subprocess.run(cmd, cwd=U.ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'})
    return p.returncode, p.stdout or '', time.time() - t, p.stderr or ''


def last_line(out: str) -> str:
    lines = [l for l in out.strip().splitlines() if l.strip()]
    return lines[-1] if lines else ''


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tiles', action='store_true', help='also run tile_qa.py')
    ap.add_argument('--strict-tiles', action='store_true', help='fail the run on tile-QA threshold violations')
    ap.add_argument('--tests', action='store_true', help='also run the unit tests')
    ap.add_argument('--offline', action='store_true', help='Wikidata cache only')
    ap.add_argument('--only', default='', help='comma-separated subset of cliopatria,gaps,modern')
    args = ap.parse_args(argv)
    only = {s for s in args.only.split(',') if s}
    py = sys.executable
    extra = ['--offline'] if args.offline else []
    report, failed = [], False
    t0 = time.time()

    if args.tests:
        for f in sorted(glob.glob(os.path.join(HERE, 'tests', 'test_*.py'))):
            code, out, dt, err = sh([py, f])
            report.append((f'test {os.path.basename(f)}', code, last_line(out), dt))
            failed |= code != 0
    for name, script in STEPS:
        if only and name not in only:
            continue
        code, out, dt, err = sh([py, os.path.join(HERE, script)] + extra)
        report.append((name, code, last_line(out), dt))
        failed |= code != 0
        if code:
            print((out + err)[-3000:], file=sys.stderr)
    if args.tiles:
        code, out, dt, err = sh([py, os.path.join(HERE, 'tile_qa.py')])
        lines = [l for l in out.strip().splitlines() if l.startswith('[tile-qa]')]
        report.append(('tiles', 'WARN' if code == 1 and not args.strict_tiles else code, lines[-1] if lines else last_line(out), dt))
        failed |= code != 0 and (code == 2 or args.strict_tiles)

    gen = sorted(glob.glob(os.path.join(U.OVERRIDES, '*', 'auto-*.json')))
    vals = []
    for f in gen:
        code, out, dt, err = sh(['node', VALIDATOR, '--file', f])
        vals.append((os.path.relpath(f, U.ROOT).replace('\\', '/'), code, last_line(out)))
        failed |= code != 0
    code, out, dt, err = sh(['node', VALIDATOR, '--complete'])
    missing = [l for l in (out + err).splitlines() if 'without a modern timeline' in l]
    vals.append(('all files --complete', code, last_line(out) + (' | ' + missing[0][:200] if missing else '')))
    failed |= bool(missing)

    print('=' * 100)
    print(f'Alex’s Atlas fact-check suite — {U.TODAY} — {time.time() - t0:.0f}s')
    print('=' * 100)
    for name, code, line, dt in report:
        tag = 'ok ' if code == 0 else 'WRN' if code == 'WARN' else 'ERR'
        print(f"{tag} {name:<28} {dt:6.0f}s  {line[:150]}")
    print('-' * 100)
    for f, code, line in vals:
        print(f"{'ok ' if code == 0 else 'ERR'} validate {f:<52} {line[:110]}")
    print('-' * 100)
    print('Reports: .cache/factcheck/{cliopatria-wikidata,coverage-gaps,modern-crosscheck}.md, tile-qa.json, tile-qa-worst.png')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
