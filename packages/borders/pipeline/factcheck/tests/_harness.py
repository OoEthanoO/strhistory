"""Plain-assert test runner shared by the fact-check tests (no pytest in the venv).

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/tests/test_dates.py [-k name]
"""
from __future__ import annotations

import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def run(namespace: dict) -> int:
    only = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else None
    tests = [f for n, f in sorted(namespace.items()) if n.startswith('test_') and callable(f) and (not only or only in n)]
    failed, t0 = [], time.time()
    for fn in tests:
        t = time.time()
        try:
            fn()
            print(f'PASS {fn.__name__} ({time.time() - t:.2f}s)')
        except Exception:  # noqa: BLE001
            failed.append(fn.__name__)
            print(f'FAIL {fn.__name__}')
            traceback.print_exc()
    print(f'\n{len(tests) - len(failed)} passed, {len(failed)} failed in {time.time() - t0:.1f}s')
    return 1 if failed else 0
