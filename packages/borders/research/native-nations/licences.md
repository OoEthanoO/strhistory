# verify-licences (independent licence re-check) — 2026-10-02
Scratch: pages/ holds raw primary pages fetched with curl (UA = desktop Chrome). Quotes are grepped verbatim from them.
Status: started.

## Progress (checks done; quotes grepped from pages/*)
- Cliopatria LICENSE.md@v0.2.0: CC BY 4.0 confirmed.
- USFS ceded lands: data.gov "Access & Use License https://creativecommons.org/licenses/by/4.0/" (DCAT from USFS hub); AGOL licenseInfo = disclaimer only; FGDC accconst None, origin USFS GSTC, datacred "USDA Forest Service Office of Tribal Relations". Saunt research "which he agreed to share with the U.S. Forest Service". -> yes.
- Royce IA: vol 18 (1896-97) pt 2, GPO, NOT_IN_COPYRIGHT. 17 USC 105 read at LII.
- Wikidata CC0, NE PD confirmed.
- TIGER 2025 AIANNH: use constraints read inside zip (.shp.iso.xml) -> not copyrighted, acknowledge Census.
- Canada CKAN: all records ca-ogl-lgo; Morris Ontario on-oglo (Document Link, no vector). OGL-C 2.0 + OGL-ON 1.0 text read; no CC compat clause; non-endorsement clause.
- ICC 1978 USGS: publisher USGS; USGS copyrights page "USGS-authored or produced data ... U.S. Public Domain".
- CORRECTION: vector ICC exists = NPS National NAGPRA digitisation (creator james_stein_nps 2016-12-13, path NAGPRA_v5_DraftData); hosted by NPS GRTE AGOL item b22f7f676e48468e85f46cb33e214e41 (298 feats, CATNUM+Affiliatio), NPS DataStore ref 2310196; NLAP CKAN (archived 2025-10/11) "License Other (Public Domain)", zip archived on Wayback (644 recs). NPS disclaimer page: NPS material "generally considered in the public domain".
- BIA AIAN-LAR: data.gov license link = idmanagement.gov/license (unrelated GSA project page) -> rely on 17 USC 105 + "These data are public information ... republication".
- ANLA: map page CC BY 4.0 for GIS+language data; map image CC BY-NC-ND 3.0 US. Archive API record has no rights field.
- AHCB: reuse for any lawful purpose statement confirmed. OHM copyright text confirmed.
- Glottolog CC BY 4.0; AUSTLANG & NNTT cc-by-4.0 (data.gov.au CKAN); QLD CC-BY-3.0 AU; TPK CC BY 4.0 + third-party disclaimer; Sametinget CC0 (atom rights); Norway NLOD 1.0 link, §10 new versions + NLOD 2.0 §9 CC BY 4.0 compat; StatFi geodata ISO record "Attribution 4.0 International (CC BY 4.0)" (NLS source).
- HSAI: govinfo Serial Set H.Doc 78-662; IA scan note "No copyright page found."
- Hodge/Powell NOT_IN_COPYRIGHT (IA); Swanton 1952 IA rights "Public domain according to HathiTrust rights database"; Kroeber 1925 (pre-1931 -> PD US); Jenness 1932 Crown s.12 (read).
- Nimuendaju: Brazil Art. 41 + posthumous; but 1944 map first published 1981 (IBGE/Pro-Memoria) -> US 17 USC 303(a) term to 2047 => tracing risky in US.
- Sturtevant: NU rights_statement InC-EDU vs terms_of_use "GPO ... public domain"; LOC 403 -> unclear.
- INEGI terms confirmed; INPI "Algunos Derechos reservados" no licence; datos.gob.mx/libreusomx 404.

## More checks (2026-10-02, later)
- TIGER data.gov HTML: "Access & Use License https://creativecommons.org/publicdomain/zero/1.0/".
- Cornell PD chart: "Before 1931 None None. In the public domain due to copyright expiration"; "1931 through 1977 Published without a copyright notice ... public domain".
- Zarur 2009 (SBPC pdf): map published 1981; 1942 version simplified in HSAI -> HSAI copy PD (GPO no notice).
- 17 USC 303(a) read: published by 2002 -> not before 31 Dec 2047.
- RAISG terms: not for profit + unaltered -> no.
- p3k14c: tDAR 403; paper CC BY 4.0 only -> unverifiable.
- Sturtevant: NU API rights_statement InC-EDU vs terms_of_use GPO PD; Yale dc_rights "Public" (access).

## Missed sources verified
- NPS ICC vector (FeatureServer/5, 298 feats, 176 CATNUM, ~149 affiliation strings incl. Plains/Basin/SW/NW nations); NLAP zip 644 (346 Unaffiliated). PD (NPS disclaimer + NLAP label). 
- Yukon FN Traditional Territories: CKAN yk-oglyk; OGL-Yukon 2.0 text via Wayback 20260831 (live yukon.ca 403); 17 polygons, RATIFIED_DATE 1993-2005; line work from 1:500k maps signed 8 Nov 1988.
- Indian Treaties and Surrenders 1680-1890 (Ottawa, Printer to the Queen 1891; vol 3 1912): Crown s.12 expired -> PD.
- BC SOI boundaries: BC catalogue licence 22 "Access Only" -> reproduction not permitted without permission -> no.
- (skipped) AU IPA Dedicated: data.gov.au cc-by-4.0 vs AGOL item CC BY 3.0 AU; modern only.
Status: ready to report.
