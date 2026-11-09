"""Build county lead-in-drinking-water data from EPA ECHO's SDWA download into src/data/lead.json.

Source: https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip (~560 MB, public)
  - SDWA_LCR_SAMPLES.csv: Lead and Copper Rule results; contaminant PB90 = 90th percentile lead (mg/L)
  - SDWA_PUB_WATER_SYSTEMS.csv: active community water systems
  - SDWA_GEOGRAPHIC_AREAS.csv: counties each system serves (ANSI county codes)

Each system's most recent 90th-percentile lead result (ppb) is assigned to every county it serves. A county's
value is the highest of its systems; also counts systems above EPA's 15 ppb action level.

Usage: python3 scripts/build_lead.py
"""
import csv
import io
import json
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
URL = "https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip"
ACTION_PPB = 15.0
MAX_PLAUSIBLE_PPB = 500.0
STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
    "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
    "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
    "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
}


def rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8", errors="replace"))


def main():
    with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=900) as r:
            while chunk := r.read(1 << 20):
                tmp.write(chunk)
        tmp.flush()
        z = zipfile.ZipFile(tmp.name)

        systems = {}
        for r in rows(z, "SDWA_PUB_WATER_SYSTEMS.csv"):
            if r["PWS_TYPE_CODE"] == "CWS" and r["PWS_ACTIVITY_CODE"] == "A":
                systems[r["PWSID"]] = r["PWS_NAME"]

        latest = {}  # pwsid -> (date, ppb)
        for r in rows(z, "SDWA_LCR_SAMPLES.csv"):
            if r["CONTAMINANT_CODE"] != "PB90" or r["PWSID"] not in systems or not r["SAMPLE_MEASURE"]:
                continue
            try:
                d = datetime.strptime(r["SAMPLING_END_DATE"], "%m/%d/%Y")
                ppb = float(r["SAMPLE_MEASURE"]) * 1000 if r["UNIT_OF_MEASURE"] == "mg/L" else float(r["SAMPLE_MEASURE"])
            except ValueError:
                continue
            # drop obvious data-entry errors: future dates and unit mix-ups
            if d > datetime.now() or ppb > MAX_PLAUSIBLE_PPB or ppb < 0:
                continue
            if r["PWSID"] not in latest or d > latest[r["PWSID"]][0]:
                latest[r["PWSID"]] = (d, ppb)

        counties = defaultdict(set)
        for r in rows(z, "SDWA_GEOGRAPHIC_AREAS.csv"):
            pws = r["PWSID"]
            if pws in latest and r["AREA_TYPE_CODE"] == "CN" and r["ANSI_ENTITY_CODE"]:
                st = STATE_FIPS.get(pws[:2])
                if st:
                    counties[st + r["ANSI_ENTITY_CODE"].zfill(3)].add(pws)

    names = {k: v["name"] for k, v in json.loads((DATA / "pres2020.json").read_text()).items()}
    out = {}
    for fips, ids in counties.items():
        vals = [latest[p][1] for p in ids]
        out[fips] = {
            "name": names.get(fips, fips),
            "max": round(max(vals), 1),
            "systems": len(vals),
            "over": sum(v > ACTION_PPB for v in vals),
            "year": max(latest[p][0].year for p in ids),
        }
    (DATA / "lead.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(latest), "systems with a PB90 result;", len(out), "counties")


if __name__ == "__main__":
    main()
