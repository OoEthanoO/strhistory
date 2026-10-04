# worldwide indigenous sources audit (agent label: worldwide) — started 2026-10-02
Repo facts (read-only):
- polities index: 15 kind=indigenous pids, all from overrides (Cliopatria has none tagged indigenous):
  NA 7 (Cherokee etc, Haudenosaunee), Panama comarcas 3 (NE admin1), Andaman/Nicobar 4, Ainu Mosir 1.
- No polity at all in New Zealand before 1946; Australia only Commonwealth of Australia 1905-1945 (no colonies, no Aboriginal overlays).
- factcheck/coverage_gaps.py: indigenousRoots = Q133311 tribe only; ethnic group Q41710 is nonPolitical -> excluded.
  auto-gaps: only 3 indigenous known-gaps (Cherokee, Navajo, Choctaw) in historical, ~2 in early.
## sources checked (verbatim quotes in sources.jsonl as I go)
- D-PLACE: site + dplace-cldf + dplace-dataset-ea + binford all "CC-BY-NC-4.0" (read d-place.org/about, /download, GitHub READMEs) -> NO.
- Glottolog 5.3 (site) / CLDF 5.2.1 metadata dc:license CC BY 4.0. languages.csv: 8618 languages, 8304 with lat/lon; 1013 have Last_Year_Of_Documentation. Points = languages not polities.
- Wikidata SPARQL (2026-10-02, direct P31): ethnic group Q41710 10774 items, 169 with P625, 42 start, 21 end, 0 geoshape;
  indigenous people Q103817 578/17/4/3; tribe Q133311 1764/59/21/16; First Nation band Q2882257 627/581 coords/27 start;
  Native American tribe Q12885585 43/0; iwi Q1676081 500/1/0; hapu Q675182 515/0/0; chiefdom Q1642488 42/7/17/16.
  13403 people items: 365 link P2936 language->P1394 glottocode, 287 have P2341 indigenous-to, 8339 enwiki.
- auto-gaps already list precolonial African/Andean/Pacific polities on unclaimed land (Maravi, Mutapa, Rozwi, Kaffa, Loango, Luba, Mthethwa, Tiwanaku, Wari, Colla...).
- AIATSIS map (Horton 1996): shop.aiatsis.gov.au/pages/map-licensing "The map cannot be reproduced without approval from ASP." + "you must seek permission each time you use the map in a different form." aiatsis.gov.au pages 403 (search snippet: no geospatial mapping, no overlays, permission non-transferable) -> NO.
- AUSTLANG on data.gov.au (package austlang-dataset-001): license_title "Creative Commons Attribution 4.0 International"; points ("approximate location of each language variety"); CSV host api.aiatsis.gov.au did not resolve from here.
- NNTT Native Title Determinations / Outcomes on data.gov.au: CC BY 4.0, polygons (shp, GeoJSON WFS), modern legal (1990s+). nntt.gov.au 403.
- QLD: SLQ Indigenous languages map data CC BY 4.0 (CSV, couldn't download: 202 empty); Cultural Heritage Party boundaries QLD CC BY 3.0 AU (polygons, statutory).
- NZ: TPK "Iwi Areas of Interest" ArcGIS item 1016f88251c5402291c1aa5020aab02d owner tpkmaps licenseInfo "Creative Commons Attribution 4.0 International ( CC BY 4.0 )" + disclaimer; 112 polygons; traced from iwi maps / Treaty settlement docs; modern AOIs overlapping.
  TKM website copyright: "Crown Copyright unless otherwise stated... may be reproduced for personal, not-for-profit or in-house use" (site, not the dataset).
- RAISG terms (raisg.org/en/terms-of-use/) s5: "may be used ... 1) such use is not for profit; 2) the data downloaded remain unaltered; 3) citation" -> NO (NC+ND).
- InfoAmazonia: all pages 403; not verified; its TI layers are RAISG/FUNAI re-publications -> skip.
- FUNAI (gov.br/funai .../geoprocessamento-e-mapas): "Licença de uso: o conteúdo dos arquivos correspondentes a geoprocessamento e mapas poderão ser reproduzidos desde que citada a fonte, excetuando os casos especificados em contrário e os conteúdos replicados de outras fontes." Footer: "Todo o conteúdo deste site está publicado sob a licença Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada". GeoServer layers tis_poligonais etc. -> conditional/unclear (modification not granted explicitly).
- Colombia ANT Resguardo Indigena Formalizado: "Licencia Creative Commons Atribución-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)", 984 records -> NO.
- LandMark access-data page: IPLC Lands and Territories "CC BY-SA 4.0"; Indicative Areas "CC BY-SA 4.0" -> NO.
- Native Land Digital api-docs data-sovereignty-treaty: non-commercial; "Store or distribute API data without explicit permission" prohibited -> NO.
- OHM copyright page: "Except where otherwise noted, OpenHistoricalMap data is dedicated to the public domain under a Creative Commons CC0 dedication." + features "under an open license, such as ... (CC BY) or ... (CC BY-SA), as noted in license=* tags". Overpass 2026-10-02: only 13 relations boundary=indigenous_administration/aboriginal_lands (all N. America: Chickasaw, Choctaw, Wendat, Navajo, Gila River, Wind River, Kansas...), 203 boundary relations with nation-ish names, licence tags none or CC0-1.0.
- Norway Landbruksdirektoratet "Reindrift - Reinbeiteområde" (Geonorge d02dc4bd...): NLOD 1.0; NLOD 1.0 s10 allows choosing later version; NLOD 2.0 s9 lists CC BY 4.0 as compatible -> yes.
- Sweden Sametinget "Renskötselområdet" Atom feed rights = https://creativecommons.org/publicdomain/zero/1.0/ ; GML download Renskoetselomraadet-ETRS89-2020-07-08.gml -> yes (CC0). Modern conceptual extent (SOU 2006:14).
- GRID-Arendal (grida.no/resources/7747 footer): "Except where otherwise noted, content on this site is licensed under a Attribution-NonCommercial-ShareAlike 4.0 International Licence" -> NO.
- GREG (icr.ethz.ch/data/greg/): 8969 polygons from Atlas Narodov Mira (1964); no licence, only "please cite" -> unclear -> NO.
- Nunn Murdock 1959 Africa shapefile v2 (Feb 2025) nathannunn.arts.ubc.ca/data: no licence on page; sboysel/murdock R package DESCRIPTION "License: CC BY-NC-SA 3.0" -> unclear/NO.
TODO: Nimuendajú 1944 (PD in Brazil since 2016?) + IBGE terms; WDPA terms; Taiwan OGDL; Te Ara licence; Peru BDPI; Mexico INPI.
- Nimuendajú map: IBGE facsimile PDF liv81619.pdf (2002) has "©IBGE. 2002", eds 1981/1987/2002; author d. 1945-12-10 (Wikidata Q73230) -> map PD in Brazil (70 pma) since 2016; facsimile editorial matter (C) IBGE. ~900+ references 16th-20th c (2017 IPHAN ed.).
- Author deaths (Wikidata P570): Tindale 1993 (not PD), Howitt 1908, Mathews 1918, Curr 1889, Percy Smith 1922 (PD), Murdock 1985.
- WDPA/WDPCA (protectedplanet.net/en/legal): "No Commercial Use" + "You may not redistribute the WDPCA and GD-PAME Data" -> NO (ICCAs too).
- Mexico datos.gob.mx: INPI/INALI datasets CC BY 4.0 but tabular (no territories).
- Not reachable: Te Ara (403), data.gov.tw licence page (JS), LOC (403), Peru datosabiertos (301), InfoAmazonia (403), nntt.gov.au (403), aiatsis.gov.au (403), data.govt.nz (bot wall).
- Probe of built data (l0, probe.py / probe-out.txt here): no tier-1 indigenous overlay at any of 44 probe points outside N. America except Ainu Mosir (Hokkaido 1700-1850).
  Unclaimed until colonial claim: C. Australia ->1880 (British Colonial Empire), Perth ->1900, Sydney ->1800; NZ ->1880; Patagonia/Araucania/Tierra del Fuego ->1900;
  Amazon ->1700 (Portuguese Empire), Loreto/Chaco ->1800; Siberia ->1700/1750; Kalahari, Namaqualand, Ituri, Maasai, Ogaden, Borneo, PNG ->1900; Hoggar ->1945; Tonga unclaimed even 1945; Fiji ->1880.
- Wikidata licensing page raw: "All structured data (i.e. the main, Property, Lexeme, and EntitySchema namespaces) is released into the public domain under Creative Commons Zero."
- Wikidata TI classes: Q6024666 (indigenous territory of Brazil) 132 items, 42 coords, 19 start, 0 geoshape; Q155239 Indian reservation of Canada 3489 items, 3479 coords, 0 geoshape.
- Statistics Finland terms: open data CC BY 4.0 (for Sámi homeland municipalities).
- Handbook of South American Indians = H. Doc. 78-662 (Serial Set, GPO) BAE Bull. 143 (govinfo) -> PD (US govt doc); contact-era tribal maps.
- Gallica scans: "La réutilisation commerciale de ces contenus est payante et fait l'objet d'une licence" -> prefer LOC/IA/HathiTrust/Commons scans for hand-tracing.
- Wikidata->Glottolog join (P103|P2936|lang P2341/P1412 -> P1394): 1467 people items linked, 1452 get a Glottolog point (Eurasia 638, S.America 253, Africa 205, Papunesia 131, N.America 112, Australia 21); many multi-macroarea = world languages (Spanish etc.) -> must filter.
- NNTT determinations (data.gov.au WFS GeoJSON, ~94 MB): 689 features, DETDATE 1992-2026, 554 with native title existing, 354 >= 1000 km2, fields NAME, NTHOLD, DETDATE, DETOUTCOME.
- Finland Sámi homeland: Laki saamelaiskäräjistä 974/1995 s4 (finlex): Enontekiö, Inari, Utsjoki + Lapin paliskunta in Sodankylä.
- Repo: no SPDX allow/deny "licence gate" found in pipeline code (grep); sources hard-coded in pipeline/config.json + steps/lib/attribution.mjs (cliopatria, naturalearth, override); src/manifest.ts LICENSE_URLS only CC-BY-4.0.
- Gambay (First Languages Australia): no licence/terms text retrievable (JS app) -> unclear.
- BRWA (Indonesia wilayah adat): licence not found -> unclear.
## STATUS 2026-10-02: research complete; final answer returned via StructuredOutput (sources: Wikidata, Glottolog, AUSTLANG, NNTT, TPK AOI, Sametinget, NO reindeer, OHM, Stat Finland, QLD CHP, BAE Handbook SA, Nimuendajú, FUNAI, + rejected D-PLACE, AIATSIS, RAISG, LandMark, ANT, Native Land, GRID-Arendal, WDPA, GREG, Nunn, InfoAmazonia).
