"""Clipped-record store: metadata in a pickle, geometries as WKB blobs in one binary
file with an offset index, so frame workers load only the records they need.

    <prefix>.meta.pkl   {'records': [meta dicts without geometry], ...extra}
    <prefix>.geoms.bin  concatenated WKB (raw then clipped per record)
"""
from __future__ import annotations

import os
import pickle

import shapely

import common as C


def write_store(prefix: str, records: list[dict], extra: dict | None = None) -> None:
    """records: dicts with 'geometry' (raw, snapped) and 'clipped' (on land)."""
    os.makedirs(os.path.dirname(prefix), exist_ok=True)
    metas = []
    tmp_bin = prefix + '.geoms.bin.tmp'
    with open(tmp_bin, 'wb') as f:
        off = 0
        for r in records:
            meta = {k: v for k, v in r.items() if k not in ('geometry', 'clipped')}
            for key in ('geometry', 'clipped'):
                blob = shapely.to_wkb(r[key]) if r.get(key) is not None else b''
                f.write(blob)
                meta[f'_{key}'] = (off, len(blob))
                off += len(blob)
            metas.append(meta)
    os.replace(tmp_bin, prefix + '.geoms.bin')
    C.save_pickle(prefix + '.meta.pkl', {'records': metas, **(extra or {})})


class GeomStore:
    """Read side of write_store. `meta[i]` is record i's metadata; geometries load
    on demand and are cached."""

    def __init__(self, prefix: str):
        self.prefix = prefix
        data = C.load_pickle(prefix + '.meta.pkl')
        self.meta: list[dict] = data.pop('records')
        self.extra = data
        self._f = None
        self._cache: dict[tuple[int, str], object] = {}

    def __len__(self):
        return len(self.meta)

    def _read(self, i: int, key: str):
        off, n = self.meta[i][f'_{key}']
        if n == 0:
            return None
        if self._f is None:
            self._f = open(self.prefix + '.geoms.bin', 'rb')
        self._f.seek(off)
        return shapely.from_wkb(self._f.read(n))

    def raw(self, i: int):
        k = (i, 'geometry')
        g = self._cache.get(k)
        if g is None:
            g = self._cache[k] = self._read(i, 'geometry')
        return g

    def clipped(self, i: int):
        k = (i, 'clipped')
        g = self._cache.get(k)
        if g is None:
            g = self._cache[k] = self._read(i, 'clipped')
        return g

    def forget(self, keep: set[int]) -> None:
        """Drop cached geometries of records not in `keep`."""
        for k in [k for k in self._cache if k[0] not in keep]:
            del self._cache[k]

    def record(self, i: int) -> dict:
        """Full record dict (metadata + raw geometry + clipped)."""
        r = {k: v for k, v in self.meta[i].items() if not k.startswith('_')}
        r['geometry'] = self.raw(i)
        r['clipped'] = self.clipped(i)
        return r

    def close(self):
        if self._f is not None:
            self._f.close()
            self._f = None


class MultiStore:
    """Several GeomStores (historical, modern) read as one record list: record i of
    the view is record j of store k in concatenation order."""

    def __init__(self, prefixes: list[str]):
        self.stores = [GeomStore(p) for p in prefixes]
        self.meta: list[dict] = []
        self._where: list[tuple[int, int]] = []
        for k, s in enumerate(self.stores):
            for j in range(len(s)):
                self.meta.append(s.meta[j])
                self._where.append((k, j))

    def __len__(self):
        return len(self.meta)

    def raw(self, i: int):
        k, j = self._where[i]
        return self.stores[k].raw(j)

    def clipped(self, i: int):
        k, j = self._where[i]
        return self.stores[k].clipped(j)

    def forget(self, keep: set[int]) -> None:
        local: list[set[int]] = [set() for _ in self.stores]
        for i in keep:
            k, j = self._where[i]
            local[k].add(j)
        for s, ks in zip(self.stores, local):
            s.forget(ks)

    def close(self):
        for s in self.stores:
            s.close()


def exists(prefix: str) -> bool:
    return os.path.exists(prefix + '.meta.pkl') and os.path.exists(prefix + '.geoms.bin')


def load_pickle_records(path: str) -> dict:
    with open(path, 'rb') as f:
        return pickle.load(f)
