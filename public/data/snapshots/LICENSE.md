# Historical border data — licence and attribution

The `world_<year>.geojson` files in this folder are simplified derivatives of
[aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)
by André Ourednik and contributors, licensed under the
[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).
They remain under GPL-3.0. They were produced by `scripts/data/build-snapshots.mjs`
(simplification with mapshaper, per-year name corrections from
`scripts/data/name-overrides.json`, label points added with polylabel).

The upstream project notes that borders are approximate, especially for earlier
periods, and should be checked against other sources before academic use.

`../land.geojson` is derived from Natural Earth (public domain).

`world_2026.geojson`, the present-day map, is the exception: it is derived from
[Natural Earth](https://www.naturalearthdata.com/) (public domain), not from
historical-basemaps — Admin 0 countries in the ISO 3166 point of view, with
gaps for contested territories filled from Natural Earth's disputed areas.
