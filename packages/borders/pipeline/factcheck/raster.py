"""Even-odd scanline rasteriser and connected components in numpy.

A pixel (row r, column c) is inside when its centre (c + 0.5, r + 0.5) is inside the
rings under the even-odd rule. Edges are half-open in y (ymin <= yc < ymax) and spans
half-open in x (xs <= xc < xe), so two polygons sharing an edge never both claim a
pixel and never both miss it (top-left rule).
"""
from __future__ import annotations

import numpy as np


def fill(rings: list[np.ndarray], width: int, height: int) -> np.ndarray:
    """Boolean mask (height, width) of rings given in pixel coordinates."""
    segs = []
    for r in rings:
        if len(r) < 3:
            continue
        if not np.array_equal(r[0], r[-1]):
            r = np.vstack([r, r[:1]])
        segs.append(np.column_stack([r[:-1], r[1:]]))
    mask = np.zeros((height, width), dtype=bool)
    if not segs:
        return mask
    e = np.concatenate(segs)
    x0, y0, x1, y1 = e[:, 0], e[:, 1], e[:, 2], e[:, 3]
    keep = y0 != y1
    x0, y0, x1, y1 = x0[keep], y0[keep], x1[keep], y1[keep]
    ymin, ymax = np.minimum(y0, y1), np.maximum(y0, y1)
    r_lo = np.ceil(ymin - 0.5).astype(np.int64)
    r_hi = np.ceil(ymax - 0.5).astype(np.int64) - 1
    r_lo = np.maximum(r_lo, 0)
    r_hi = np.minimum(r_hi, height - 1)
    ok = r_lo <= r_hi
    if not ok.any():
        return mask
    x0, y0, x1, y1, r_lo, r_hi = x0[ok], y0[ok], x1[ok], y1[ok], r_lo[ok], r_hi[ok]
    counts = r_hi - r_lo + 1
    total = int(counts.sum())
    idx = np.repeat(np.arange(len(counts)), counts)
    starts = np.cumsum(counts) - counts
    rows = r_lo[idx] + (np.arange(total) - np.repeat(starts, counts))
    yc = rows + 0.5
    xc = x0[idx] + (yc - y0[idx]) * (x1[idx] - x0[idx]) / (y1[idx] - y0[idx])
    order = np.lexsort((xc, rows))
    rows, xc = rows[order], xc[order]
    # position of each crossing within its row -> pair (even, odd)
    first = np.r_[True, rows[1:] != rows[:-1]]
    row_start = np.maximum.accumulate(np.where(first, np.arange(total), 0))
    pos = np.arange(total) - row_start
    even = (pos % 2) == 0
    # rows always hold an even number of crossings for closed rings; guard anyway
    ev_idx = np.nonzero(even)[0]
    ev_idx = ev_idx[ev_idx + 1 < total]
    ev_idx = ev_idx[rows[ev_idx + 1] == rows[ev_idx]]
    rr = rows[ev_idx]
    c0 = np.clip(np.ceil(xc[ev_idx] - 0.5).astype(np.int64), 0, width)
    c1 = np.clip(np.ceil(xc[ev_idx + 1] - 0.5).astype(np.int64), 0, width)
    good = c1 > c0
    rr, c0, c1 = rr[good], c0[good], c1[good]
    diff = np.zeros((height, width + 1), dtype=np.int32)
    np.add.at(diff, (rr, c0), 1)
    np.add.at(diff, (rr, c1), -1)
    return np.cumsum(diff[:, :width], axis=1) > 0


def components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected components of a boolean mask: (labels with -1 outside, count)."""
    h, w = mask.shape
    n = h * w
    lab = np.where(mask.ravel(), np.arange(n), n).astype(np.int64)
    lab2 = lab.reshape(h, w)
    big = n
    while True:
        cur = lab.reshape(h, w)
        m = cur.copy()
        m[1:, :] = np.minimum(m[1:, :], np.where(mask[:-1, :] & mask[1:, :], cur[:-1, :], big))
        m[:-1, :] = np.minimum(m[:-1, :], np.where(mask[1:, :] & mask[:-1, :], cur[1:, :], big))
        m[:, 1:] = np.minimum(m[:, 1:], np.where(mask[:, :-1] & mask[:, 1:], cur[:, :-1], big))
        m[:, :-1] = np.minimum(m[:, :-1], np.where(mask[:, 1:] & mask[:, :-1], cur[:, 1:], big))
        m = np.where(mask, m, big).ravel()
        # pointer jumping: follow labels to their roots
        inside = m < big
        while True:
            nxt = m.copy()
            nxt[inside] = m[m[inside]]
            if np.array_equal(nxt, m):
                break
            m = nxt
        if np.array_equal(m, lab):
            break
        lab = m
    del lab2
    out = np.full(n, -1, dtype=np.int64)
    roots = lab[lab < big]
    uniq, inv = np.unique(roots, return_inverse=True)
    out[lab < big] = inv
    return out.reshape(h, w), len(uniq)


def touches_border(labels: np.ndarray, count: int) -> np.ndarray:
    edge = np.zeros(count, dtype=bool)
    for side in (labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]):
        v = side[side >= 0]
        edge[v] = True
    return edge


def adjacent(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pixels of a that have a 4-neighbour in b."""
    nb = np.zeros_like(b)
    nb[1:, :] |= b[:-1, :]
    nb[:-1, :] |= b[1:, :]
    nb[:, 1:] |= b[:, :-1]
    nb[:, :-1] |= b[:, 1:]
    return a & nb
