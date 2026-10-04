# Historical border data

`prebaked_1789.json` is a simplified derivative of the Alex's Atlas borders
dataset (`packages/borders/data`), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): historical borders
from Cliopatria (Seshat Global History Databank), Bennett et al., *Scientific
Data* 12, 247 (2025), doi:10.1038/s41597-025-04516-9, CC BY 4.0 — modified
(leaf polities only, clipped to Natural Earth land, islands assigned, corrected
by Alex's Atlas overrides); made with Natural Earth. Full attribution:
`packages/borders/data/ATTRIBUTION.md`.

Changes for this file: the 1789 frame's polities at the coarsest level of detail,
simplified further for the immediately rendered, interactive SVG globe, with
their map colours. Regenerate it with `node scripts/data/build-prebaked.mjs`.
