"""Build a county Environmental Justice score into src/data/ej.json.

Source: CDC/ATSDR Environmental Justice Index (EJI) 2024, tract-level percentile ranks (RPL_EJI,
0-1, higher = greater cumulative environmental burden), via its public ArcGIS feature service.
Tracts are averaged to counties weighted by tract population.

Usage: python3 scripts/build_ej.py
"""
import json
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
SERVICE = "https://services2.arcgis.com/I9nxaBNNOyopX343/arcgis/rest/services/USA_Environmental_Justice_Index_2024/FeatureServer/0/query"
PAGE = 2000


def get(offset):
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "STATEFP,COUNTYFP,COUNTY,STATEABBR,E_TOTPOP,RPL_EJI",
        "returnGeometry": "false", "orderByFields": "OBJECTID", "resultOffset": offset,
        "resultRecordCount": PAGE, "f": "json",
    })
    req = urllib.request.Request(f"{SERVICE}?{q}", headers={"User-Agent": "swivel-build"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def main():
    acc = defaultdict(lambda: [0.0, 0.0, "", 0])  # weighted sum, weight, name, tracts
    offset = 0
    while True:
        payload = get(offset)
        feats = payload.get("features", [])
        for f in feats:
            a = f["attributes"]
            score, pop = a["RPL_EJI"], a["E_TOTPOP"]
            if score is None or score < 0 or not pop or pop < 0:
                continue
            fips = f"{a['STATEFP']}{a['COUNTYFP']}"
            row = acc[fips]
            row[0] += score * pop
            row[1] += pop
            row[2] = f"{a['COUNTY']}, {a['STATEABBR']}"
            row[3] += 1
        offset += len(feats)
        print(offset)
        if not feats or not payload.get("exceededTransferLimit"):
            break
    out = {k: {"name": v[2], "score": round(v[0] / v[1], 3), "tracts": v[3]} for k, v in acc.items() if v[1]}
    (DATA / "ej.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(out), "counties; CT:", sorted(k for k in out if k.startswith("09")))


if __name__ == "__main__":
    main()
