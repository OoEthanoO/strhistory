NATIVE NATIONS PLAN (research workflow, 2026-10-02). Licence quotes and URLs: licences.md; research notes beside it (inventory.md, north-america.md, worldwide.md, method.md). The raw pages the licence check read are not kept in the repo.

1. SHORT ANSWER
Yes for the treaty era (US 1784–1894, Canada 1725–1923, Alaska c. 1900) and partly back to c. 1630, but not as real borders "all the way back".
Open, redistributable US and Canadian data can be turned by a program into hatched, approximate overlays for roughly 100–250 US nations plus Canada's treaty regions, Alaska and Yukon: most of the Plains, Basin, Plateau, Southwest and California would show their nations from first treaty to final cession, where the map now shows "unclaimed" land or only the US.
Before a nation's first treaty or dated map no usable source gives boundaries, so earlier centuries can show only named peoples as dated points, archaeological cultures with date ranges, and the pre-contact states already drawn (Maya, Aztec, Inca, Chaco).
Elsewhere the open data are modern legal areas (Australian native title, NZ iwi areas, Sámi herding areas); historical depth there means slow, hand-traced, sourced regional overlays. Native Land Digital, the best-known map, cannot be used.

2. RECOMMENDED SOURCES (all verified redistributable; each credit goes into manifest.json, data/ATTRIBUTION.md and About)
- USFS "Tribal Lands Ceded to the United States" (Royce 1899 digitised; CC BY 4.0 on the Forest Service's data.gov record; also a federal work): 718 polygons, cessions and reservations dated 1784–1893, 37 states, Royce/Kappler links.
  Credit "USDA Forest Service, Office of Tribal Relations (2018), CC BY 4.0, digitised from C. C. Royce, Indian Land Cessions in the United States (1899)" + changes. It already ships in our 57 curated adds but is missing from all three credits.
- NPS (National NAGPRA) vector of the USGS/Indian Claims Commission map "Indian Land Areas Judicially Established" (1978; US public domain; draft): 176 areas, ~149 tribe names (Teton & Yanktonai Sioux, Crow, Cheyenne & Arapaho, Shoshone, Paiute, Navajo, Hopi, Apache, Nez Perce…).
  One court-proven territory per tribe, incl. land taken without a recorded cession; no dates in the layer. Credit "National Park Service, National NAGPRA Program, after USGS for the Indian Claims Commission (1978)".
- Royce 1899 schedule and maps (archive.org, public domain): dates, cession-vs-assignment wording, citations.
- Census TIGER/Line 2025 AIANNH (not copyrighted; credit "Source: U.S. Census Bureau, TIGER/Line Shapefiles 2025"): 25 Oklahoma areas approximating the former reservations (dates to be sourced); 47 reservations of 1,000 km² or more for 1946+.
- OGL-Canada (credit "Contains information licensed under the Open Government Licence – Canada" + link): CIRNAC Historic Treaties (17 areas 1725–1923, some "illustrative"); NRCan Atlas of Canada "Native Peoples" c. 1630/1740/1823 (scans: named peoples as point symbols, roughly 150 in 1630; archaeological complexes AD 1000–1700); CIRNAC Modern Treaties (1976+).
- Indian Treaties and Surrenders 1680–1890 (+ vol. 3, 1912; public domain): dated Upper Canada surrenders and signatories; geometry traced by hand on the Morris 1943 Ontario plan (OGL-Ontario statement).
- Yukon First Nation Traditional Territories (OGL-Yukon 2.0, read on an archived copy; same credit form): 17 polygons, 14 First Nations plus Inuvialuit and Gwich'in areas, from the 1988 signed maps (modern definitions).
- Alaska Native Language Archive IPLA GIS (CC BY 4.0 for the GIS files only; the map image is NC-ND): ~20 regions, "traditional territories at approximately 1900"; credit Krauss, Holton, Kerr & West 2011.
- Wikidata (CC0): ids, names, alt names, gap lists, no territories. Glottolog (CC BY 4.0, pin a release; credit Hammarström et al.): 8,304 language points. OpenHistoricalMap: CC0 elements without OSM provenance only; thin (~45 North American nations), a cross-check.
- Public domain for hand-tracing: Hodge 1907–10, Kroeber 1925, Swanton 1952, Jenness 1932, Handbook of South American Indians (BAE Bull. 143); cite edition and page. Newberry county atlas ("reused for any lawful purpose"; credit the Newberry Library) for the US-claims fix.
- Modern legal areas elsewhere: Australia NNTT native title (CC BY 4.0; 689 areas, 1992–2026), AUSTLANG points (CC BY 4.0); NZ Te Puni Kōkiri iwi areas (CC BY 4.0; 112, overlapping, undated); Sápmi: Sweden (CC0), Norway (NLOD, CC BY 4.0-compatible), Finland (CC BY 4.0). Credit NNTT, AIATSIS, Te Puni Kōkiri, Sametinget, Landbruksdirektoratet, Statistics Finland/NLS.

3. HOW IT WOULD LOOK
- Deep time (to c. 1600): no invented borders; the pre-contact states stay. Optional: archaeological cultures with date ranges as "possible affiliation" (Fort Ancient 1000–1670, possibly Shawnee), public sites only; a kind 'culture' (≈ 0.5 agent-day) would also relabel Cliopatria's Chaco "regional systems", now shown as "State".
- Contact era (c. 1600–1800): named peoples as dated points at the source's own date (Atlas of Canada; Glottolog documentation years); overlays only where an open or public-domain map shows extents. Points need an optional `places` file, `placesAt(year)`, circle and label layers, key and About text: ≈ 2–3 agent-days.
- Treaty era: tier-1 hatched, dashed overlays per nation (what US records and courts recognised, not full homelands), overlapping where lands were shared or contested, each part ending at its cession or date of taking. Pairs with the US-claims fix already offered (tier 0 from each acquisition treaty).
- Reservations/modern: Oklahoma reservations from the Census areas; from 1946 (today every US/Canada nation ends by 1945) large reservations, Canadian treaty lands and Yukon territories, each from a sourced date.
- No data-format change for overlays. UI ≈ 0.5–1 agent-day: tooltip lists every overlapping nation; one hatch colour family; "Land no polity held"/"Unclaimed land" → "No mapped polity (not empty land)"; About: an overlay ends because land changed hands, not because the nation ended. The wording can ship now.
- Watch l0 chunk sizes (planner target 350 kB gzip) after ~1,000 new records; Royce dates add at most 31 frames.

4. PHASES (rough agent-hours)
Phase 1, North America treaty era: ≈ 55–90 h, 1–3 weeks wall time; mostly deterministic code and API lookups plus three bounded review tables; usage-limit risk low–medium (no fan-out; small, saved batches).
- Credit USFS (pipeline buildSources; an About line can ship now); make the licence gate AGENTS.md describes real code (allow CC0/PD, CC BY, OGL-Canada/Ontario/Yukon, NLOD; refuse NC, SA, ND, ODbL, GPL): 3–4 h.
- Royce generator → one generated historical file: pinned download; a nation's land in year Y = union of its areas ceded after Y; tier 1, approximate, Royce/Kappler links per record; skips the 7 curated nations. Code 8–16 h.
- Review tables: 400–460 schedule names → nations, self-names and QIDs looked up via the API ("Sioux" → Dakota, Lakota, Nakota): 8–16 h; 319 multi-date rows classed cession vs assignment from the Royce text (Kansas Shawnee area 318: assigned 1825, ceded 1854): 6–8 h.
- ICC/NPS: each tribe's proven area until its date of taking where the ICC report gives it, else until the Royce cessions covering it (deterministic); merged with the same nation's Royce overlay (one feature per pid and year); spot-check the draft layer against the USGS scan: 10–16 h.
- Canada and the North: 17 treaty-region overlays with curated signatory lists 4 h; Alaska and Yukon with sourced year spans 4–8 h; fix the Haudenosaunee, drawn 'exact' 1450–1782 and as a 'state' before 1700: 1 h. UI 4–8 h; rebuild, QA, catalog, e2e 4–8 h.
Phase 2, rest of the Americas, Australia, NZ, Arctic: ≈ 80–150 h; importers deterministic, digitising manual, regional overlays research; risk medium.
- Importers for 1946+, dated by the legal act: US reservations (dates looked up; Wikidata dates only 78 of 3,930 reservation items), Canadian modern treaties, NNTT, Sápmi, NZ iwi areas (undated: decision), NE autonomies like the Panama comarcas: 30–50 h.
- Points layer with the three Atlas of Canada sheets (≈ 1 day each to digitise) and Glottolog/AUSTLANG points: 40–55 h.
- Hand-traced regional overlays from public-domain works: Amazonia, Chaco, Patagonia, Araucanía (Handbook of South American Indians); Aboriginal Australia and Māori Aotearoa, one documented regional overlay each (policy §4.5); Mexico's northern frontier: 15–30 overlays at 0.5–1.5 h.
Phase 3, deep time and worldwide: open-ended (100–600 h for pre-treaty homelands alone); nearly all research, so high risk: run only as a slow, prioritised queue, largest blank areas first.
- Pre-treaty homelands (30–90 min per nation, sourced); archaeological cultures and public sites (30–60 at 10–15 min); known-gap states already listed in auto-gaps.json (Tiwanaku, Wari, Muisca, Mutapa, Kaffa, Tuʻi Tonga…). Deterministic part: Wikidata/Glottolog to-do lists only.

5. PREREQUISITES, BLOCKERS, DECISIONS
- Rebuild: todo.md open issue 1 (pid conflicts in modern/auto-wikidata.json stop validate, check and build) looks stale (a replica of the check finds 0 conflicts in the current files); confirm with `npm run data:reference && npm run data:validate`.
- This Mac lacks the source downloads (~142 MB), the Python venv (made on first use; needs network) and .cache/reference (the validator exits 2). Build ≈ 19 min on the 16-CPU Windows host, untested here; `npm run check` fails on macOS (open issue 8); CI doesn't build data, so the rebuilt data/ (~304 MB) is committed.
- Generated files hold notes, Wikidata ids and modern unit timelines, never new shapes: a generator writing active 'add' entries is a project decision (curated files still win); polygons are inlined unless the pipeline gains a spec that references the pinned dataset.
Decisions for you:
- Overlapping hatched overlays (recommended: lands really overlapped) or one nation per place (not honestly possible).
- Start of treaty-based overlays: the year before the first treaty (strictest; recommended), the colonial claim (e.g. US 1803/1846/1848; a documented convention, but it back-projects later extents onto peoples who moved), or earlier only with sourced per-nation dates.
- Canada: end overlays at each treaty year (the Crown's reading) or keep them as shared lands with a note (many First Nations read the Numbered Treaties as sharing agreements).
- Points layer yes/no; one hatch colour or palette colours; scans digitised by a person only (recommended) or by an agent/program (a project decision).
- Sensitivity: self-names first; CARE principles and "land changed hands, the nation did not end" in About; nations continue past 1946; no non-public site locations; a corrections contact; whether Native organisations review it first (only you can arrange that).

6. CANNOT BE USED
- Native Land Digital: no storing or redistribution without permission, no altering boundaries, non-commercial, API key (runtime requests); a plain link in About is fine.
- Invasion of America (eHistory): all rights reserved. Handbook of North American Indians (vol. 1 CC BY-NC; others copyrighted) and Tanner's Great Lakes atlas (copyrighted; unverified): cite facts, never trace.
- NC/SA: D-PLACE/Ethnographic Atlas (BY-NC); HGIS de las Indias, GRID-Arendal, David Rumsey scans (BY-NC-SA); LandMark, Colombia ANT resguardos (BY-SA); OSM aboriginal_lands (ODbL).
- Permission or no-change terms: AIATSIS (Horton) map, RAISG, WDPA/ICCA, BC Statement of Intent ("Access Only"); Tindale's maps are in copyright; FUNAI (citation-only reproduction, site CC BY-ND) unclear.
- No licence stated: GREG, Murdock/Nunn Africa, Gambay, BRWA, INPI atlas; Libre Uso MX (page 404). Nimuendajú's map: first published 1981, US copyright to at least 2047: cite only.
- On hold, unverified: Sturtevant 1967 USGS map (LOC 403, contradictory record); CAST/tDAR ICC vector (unreadable; use NPS's); p3k14c radiocarbon (terms unread).
- Ruled out by the accuracy rule: areas drawn around language points (Voronoi); culture areas or language families shown as nations.