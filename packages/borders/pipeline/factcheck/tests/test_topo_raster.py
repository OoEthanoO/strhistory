"""TopoJSON decoding, even-odd rasterisation, components and Web-Mercator helpers (synthetic data)."""
from __future__ import annotations

import sys

import numpy as np
from _harness import run

import raster as R
import topo as T


def square_topo():
    # arc 0: shared edge (10,0)->(10,10); arc 1: rest of the left square; arc 2: rest of the right square
    abs_arcs = [[[10, 0], [10, 10]], [[10, 10], [0, 10], [0, 0], [10, 0]], [[10, 0], [20, 0], [20, 10], [10, 10]]]
    q = []
    for a in abs_arcs:  # delta-encode with transform scale 0.5 (quantised positions = 2 * coordinate)
        pts = np.array(a) * 2
        q.append(np.vstack([pts[:1], np.diff(pts, axis=0)]).astype(int).tolist())
    return {'type': 'Topology', 'transform': {'scale': [0.5, 0.5], 'translate': [0, 0]}, 'arcs': q,
            'objects': {'polities': {'type': 'GeometryCollection', 'geometries': [
                {'type': 'Polygon', 'arcs': [[0, 1]], 'properties': {'pid': 'left'}},
                {'type': 'MultiPolygon', 'arcs': [[[~0, 2]]], 'properties': {'pid': 'right'}}]}}}


def test_decode_quantised_delta_arcs():
    t = square_topo()
    arcs = T.decode_arcs(t)
    assert np.allclose(arcs[0], [[10, 0], [10, 10]])
    assert np.allclose(arcs[1][-1], [10, 0])
    f = T.features(t, 'polities')
    assert [x['props']['pid'] for x in f] == ['left', 'right']
    left, right = f[0]['rings'][0], f[1]['rings'][0]
    assert np.allclose(left, [[10, 0], [10, 10], [0, 10], [0, 0], [10, 0]])
    assert np.allclose(right[:2], [[10, 10], [10, 0]])  # reversed shared arc first
    assert np.allclose(right[0], right[-1]) and len(right) == 5


def test_decode_without_transform():
    t = {'type': 'Topology', 'arcs': [[[0.5, 0.5], [3.5, 0.5], [3.5, 2.5], [0.5, 0.5]]],
         'objects': {'x': {'type': 'Polygon', 'arcs': [[0]]}}}
    f = T.features(t)
    assert np.allclose(f[0]['rings'][0][1], [3.5, 0.5])


def test_raster_known_square_and_hole():
    sq = np.array([[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]], dtype=float)
    m = R.fill([sq], 32, 32)
    assert m.sum() == 100 and m[10, 10] and m[19, 19] and not m[20, 20] and not m[9, 10]
    hole = np.array([[13, 13], [17, 13], [17, 17], [13, 17], [13, 13]], dtype=float)
    assert R.fill([sq, hole], 32, 32).sum() == 100 - 16
    # partly outside the grid: clipped, no wrap-around
    big = np.array([[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], dtype=float)
    assert R.fill([big], 32, 32).sum() == 25


def test_shared_edge_no_gap_no_overlap():
    f = T.features(square_topo(), 'polities')
    a = R.fill(f[0]['rings'], 24, 12)
    b = R.fill(f[1]['rings'], 24, 12)
    assert a.sum() == 100 and b.sum() == 100
    assert not (a & b).any() and (a | b).sum() == 200
    # same at a fractional offset (edges between pixel centres)
    a2 = R.fill([r + 0.37 for r in f[0]['rings']], 24, 12)
    b2 = R.fill([r + 0.37 for r in f[1]['rings']], 24, 12)
    assert not (a2 & b2).any() and (a2 | b2).sum() == 200


def test_components_and_adjacency():
    m = np.zeros((10, 10), dtype=bool)
    m[1:3, 1:3] = True      # island inside
    m[6:10, 6:9] = True     # touches the bottom border
    m[5, 0] = True          # single pixel on the left border
    lab, n = R.components(m)
    assert n == 3
    edge = R.touches_border(lab, n)
    assert edge.sum() == 2 and not edge[lab[1, 1]]
    snake = np.zeros((7, 7), dtype=bool)
    snake[0, :] = True
    snake[:, 6] = True
    snake[6, :] = True
    snake[2:, 0] = True
    snake[2, :5] = True
    assert R.components(snake)[1] == 1
    a = np.zeros((4, 4), dtype=bool)
    b = np.zeros((4, 4), dtype=bool)
    a[1, 1] = True
    b[1, 2] = True
    assert R.adjacent(a, b).sum() == 1 and R.adjacent(a, ~a & ~b).sum() == 1


def test_mercator_helpers():
    w = T.lonlat_to_world(np.array([[0.0, 0.0], [-180.0, T.MAX_LAT], [180.0, -T.MAX_LAT]]))
    assert np.allclose(w[0], [128, 128]) and np.allclose(w[1], [0, 0], atol=1e-6) and np.allclose(w[2], [256, 256], atol=1e-6)
    assert T.tiles_for_bbox([-10, -10, 10, 10], 1) == [(1, 0, 0), (1, 0, 1), (1, 1, 0), (1, 1, 1)]
    assert T.tile_bounds_world(2, 1, 3) == (64.0, 192.0, 128.0, 256.0)


if __name__ == '__main__':
    sys.exit(run(globals()))
