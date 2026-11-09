"""Build PFAS-in-drinking-water data from EPA UCMR 5 (public domain).

Outputs:
  server/data/pfas_systems.geojson one point per water system with any PFAS detection (searchable layer)
  src/data/pfas_county.json      per-county max total PFAS (ppt) and counts (county choropleth)

UCMR 5 results don't carry coordinates, so each system is placed at the mean centroid of the ZIP codes
it serves (Census ZCTA gazetteer) and assigned to the county holding the largest share of each ZIP
(Census ZCTA-county relationship file). Locations are approximate.

Totals are the sum of detected (quantified) PFAS in a single sample, max over samples, in ng/L (ppt).

Usage: python3 scripts/build_pfas.py
"""
import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
UCMR = "https://www.epa.gov/system/files/other-files/2023-08/ucmr5-occurrence-data.zip"
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip"
REL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
LIMIT_PPT = 4.0  # EPA limit for PFOA and PFOS


def fetch(url, timeout=600):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    gaz = zipfile.ZipFile(io.BytesIO(fetch(GAZ)))
    zcta = {}
    for r in csv.DictReader(io.TextIOWrapper(gaz.open(gaz.namelist()[0]), encoding="utf-8"), delimiter="\t"):
        r = {k.strip(): v.strip() for k, v in r.items()}
        zcta[r["GEOID"]] = (float(r["INTPTLAT"]), float(r["INTPTLONG"]))

    best = {}  # zcta -> (area, county fips)
    names = {}
    for r in csv.DictReader(io.StringIO(fetch(REL).decode("utf-8-sig")), delimiter="|"):
        z, c = r["GEOID_ZCTA5_20"], r["GEOID_COUNTY_20"]
        if not z or not c:
            continue
        area = int(r["AREALAND_PART"] or 0)
        if z not in best or area > best[z][0]:
            best[z] = (area, c)
        names[c] = r["NAMELSAD_COUNTY_20"]

    z = zipfile.ZipFile(io.BytesIO(fetch(UCMR)))
    zips = defaultdict(list)
    for r in csv.DictReader(io.TextIOWrapper(z.open("UCMR5_ZIPCodes.txt"), encoding="latin-1"), delimiter="\t"):
        zips[r["PWSID"]].append(r["ZIPCODE"])

    samples = defaultdict(float)  # (pwsid, sample id) -> total ng/L
    info, pfoa, pfos = {}, defaultdict(float), defaultdict(float)
    for r in csv.DictReader(io.TextIOWrapper(z.open("UCMR5_All.txt"), encoding="latin-1"), delimiter="\t"):
        if r["AnalyticalResultsSign"] != "=" or r["Contaminant"] == "lithium" or not r["AnalyticalResultValue"]:
            continue
        pws = r["PWSID"]
        ng = float(r["AnalyticalResultValue"]) * 1000  # ug/L -> ng/L
        samples[(pws, r["SampleID"])] += ng
        info[pws] = (r["PWSName"], r["State"], r["Size"])
        if r["Contaminant"] == "PFOA":
            pfoa[pws] = max(pfoa[pws], ng)
        elif r["Contaminant"] == "PFOS":
            pfos[pws] = max(pfos[pws], ng)

    total = defaultdict(float)
    for (pws, _), v in samples.items():
        total[pws] = max(total[pws], v)

    feats, county = [], defaultdict(lambda: {"max": 0.0, "systems": 0, "over": 0})
    for pws, t in total.items():
        pts = [zcta[x] for x in zips.get(pws, []) if x in zcta]
        over = max(pfoa[pws], pfos[pws]) >= LIMIT_PPT
        for c in {best[x][1] for x in zips.get(pws, []) if x in best}:
            row = county[c]
            row["max"] = max(row["max"], t)
            row["systems"] += 1
            row["over"] += over
        if not pts:
            continue
        lat, lon = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        name, state, size = info[pws]
        details = [["Max total PFAS", f"{t:.1f} ppt"]]
        if pfoa[pws]:
            details.append(["Max PFOA", f"{pfoa[pws]:.1f} ppt"])
        if pfos[pws]:
            details.append(["Max PFOS", f"{pfos[pws]:.1f} ppt"])
        details.append(["Vs. 4 ppt PFOA/PFOS limit", "Above" if over else "Below"])
        details.append(["Location", "Approximate (ZIP code centroid)"])
        feats.append({
            "type": "Feature",
            "properties": {"id": f"pfas/{pws}", "name": name, "address": state, "details": details},
            "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
        })

    (DATA.parent.parent / "server" / "data" / "pfas_systems.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    full = {k: v["name"] for k, v in json.loads((DATA / "pres2020.json").read_text()).items()}
    out = {c: {"name": full.get(c, names.get(c, c)), "max": round(v["max"], 1), "systems": v["systems"], "over": v["over"]} for c, v in county.items()}
    (DATA / "pfas_county.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(total), "systems with detections;", len(feats), "mapped;", len(out), "counties")


if __name__ == "__main__":
    main()
