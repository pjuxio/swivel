"""Build county air quality (EPA annual AQI by county) into src/data/aqi.json.

Only counties with an EPA monitor are included. Names are matched to FIPS codes using
src/data/pres2020.json (full state names, Connecticut counties).

Usage: python3 scripts/build_aqi.py [year]
"""
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
URL = "https://aqs.epa.gov/aqsweb/airdata/annual_aqi_by_county_{year}.zip"


def norm(name):
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    n = n.replace(".", "").replace("'", "")
    n = re.sub(r"\bsaint\b", "st", n)
    n = re.sub(r"\bsainte\b", "ste", n)
    n = re.sub(r"\((city)\)", r"\1", n)
    n = re.sub(r"\b(county|parish|borough|census area|municipio|city and borough|municipality)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def main(year="2024"):
    index = {}
    for fips, v in json.loads((DATA / "pres2020.json").read_text()).items():
        county, state = v["name"].rsplit(", ", 1)
        index[(state.lower(), norm(county))] = fips

    req = urllib.request.Request(URL.format(year=year), headers={"User-Agent": "swivel-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    rows = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8"))

    out, missing = {}, []
    for row in rows:
        fips = index.get((row["State"].lower(), norm(row["County"])))
        if not fips:
            missing.append(f"{row['County']}, {row['State']}")
            continue
        days = int(row["Days with AQI"])
        unhealthy = sum(int(row[k]) for k in (
            "Unhealthy for Sensitive Groups Days", "Unhealthy Days", "Very Unhealthy Days", "Hazardous Days"))
        out[fips] = {
            "name": f"{row['County']}, {row['State']}",
            "median": int(row["Median AQI"]),
            "pctNotGood": round((days - int(row["Good Days"])) / days * 100, 1) if days else None,
            "unhealthy": unhealthy,
            "days": days,
            "year": int(row["Year"]),
        }
    (DATA / "aqi.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(out)} counties; unmatched: {missing}")


if __name__ == "__main__":
    main(*sys.argv[1:])
