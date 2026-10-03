# Licence

The data files in this folder (`manifest.json`, `chunks/`, `base/`, `polities.*.json`, `sources.json`, `qa-report.json`) form the dataset `alexs-atlas-borders` 0.1.0. They are licensed under the **Creative Commons Attribution 4.0 International** licence (CC BY 4.0).

- Summary: https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode

You may copy, redistribute and adapt the data for any purpose, including commercially, provided you give appropriate credit, provide a link to the licence and indicate if changes were made. Use the credit line in `ATTRIBUTION.md` (also `manifest.json` → `attribution.text` / `attribution.html`).

The licence follows from Cliopatria (CC BY 4.0); Natural Earth is in the public domain and adds no conditions. The code of the `@alexs-atlas/borders` package is licensed separately (see its `package.json`).

## Sources and changes made

| Source | Version | Licence | Changes made by Alex’s Atlas |
| --- | --- | --- | --- |
| Cliopatria (Seshat Global History Databank) | v0.2.0 | CC BY 4.0 | leaf polities only, clipped to Natural Earth land, islands assigned, corrected by Alex’s Atlas overrides |
| Natural Earth | v5.1.2 | Public domain | land and minor islands dissolved and used as the coastline that clips every polity; admin-0/admin-1 units assembled into yearly polities from 1946; lakes and land simplified per level of detail |
| Alex’s Atlas overrides | 0.1.0 | CC BY 4.0 | manual, sourced fixes: missing polities, indigenous nations, corrected names and dates, island ownership, modern unit timelines |

Geometry is simplified per level of detail (spherical Douglas–Peucker; tolerances in `manifest.json` → `lods`) and quantized as TopoJSON.

## No warranty

Historical borders are approximate and contested; the data is provided "as is", without warranty of any kind. Report errors via the override files described in `packages/borders/AGENTS.md`.
