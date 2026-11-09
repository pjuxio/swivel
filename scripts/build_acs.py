"""Build county ACS demographic measures for the map layers into src/data/acs.json.

Measures (percent of residents unless noted): hispanic, asian, aian (Native American / Alaska Native),
foreign-born, poverty, broadband (households with a broadband subscription), plus median household income in dollars.
Uses Census Reporter (no API key needed), ACS 2024 5-year release (2020-2024). Connecticut comes back as
planning regions (09110-09190), matching src/data/ct_regions.json.

Usage: python3 scripts/build_acs.py
"""
import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "data"
URL = (
    "https://api.censusreporter.org/1.0/data/show/latest"
    "?table_ids=B02001,B03002,B05002,B17001,B19013,B28002&geo_ids=050%7C04000US{state}"
)
STATES = [f"{i:02d}" for i in range(1, 57) if i not in (3, 7, 14, 43, 52)] + ["72"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "swivel-build"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def pct(part, whole):
    if part is None or not whole or whole < 0 or part < 0:
        return None
    return round(part / whole * 100, 1)


def main():
    out = {}
    for st in STATES:
        payload = get(URL.format(state=st))
        for geoid, t in payload["data"].items():
            fips = geoid.split("US")[1]
            if len(fips) != 5:
                continue
            e = {k: v["estimate"] for k, v in t.items()}
            income = e["B19013"]["B19013001"]
            out[fips] = {
                "name": payload["geography"][geoid]["name"],
                "hispanic": pct(e["B03002"]["B03002012"], e["B03002"]["B03002001"]),
                "asian": pct(e["B02001"]["B02001005"], e["B02001"]["B02001001"]),
                "aian": pct(e["B02001"]["B02001004"], e["B02001"]["B02001001"]),
                "foreign": pct(e["B05002"]["B05002013"], e["B05002"]["B05002001"]),
                "poverty": pct(e["B17001"]["B17001002"], e["B17001"]["B17001001"]),
                "broadband": pct(e["B28002"]["B28002004"], e["B28002"]["B28002001"]),
                "income": round(income) if income and income > 0 else None,
            }
        print(st, len(out))
    (OUT / "acs.json").write_text(json.dumps(out, separators=(",", ":")))


CHR2025 = "https://www.countyhealthrankings.org/sites/default/files/media/document/analytic_data2025_v2.csv"


def build_life_expectancy():
    """Life expectancy (years) by county from the County Health Rankings 2025 release -> life.json."""
    import csv
    import io
    req = urllib.request.Request(CHR2025, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        reader = csv.DictReader(io.StringIO(r.read().decode("utf-8-sig")))
        next(reader)  # second header row holds variable codes
        out = {}
        for row in reader:
            fips, v = row["5-digit FIPS Code"], row["Life Expectancy raw value"]
            if fips.endswith("000") or not v:
                continue
            out[fips] = {"name": f"{row['Name']}, {row['State Abbreviation']}", "years": round(float(v), 1)}
    (OUT / "life.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(out), "counties with life expectancy; CT:", sorted(k for k in out if k.startswith("09")))


if __name__ == "__main__":
    main()
    build_life_expectancy()
