"""Build county-level data layers for the map.

Also builds src/data/pres20XX.json (presidential results by county) via build_presidential().

Build county-level % Black / African American (ACS table B02001) and county shapes.

Writes src/data/blackpop.json ({fips5: {pct, name}}) and src/data/counties.topo.json.
Uses Census Reporter (no API key needed); the Census API itself now requires a key.

Usage: python3 scripts/build_blackpop.py
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "data"
REPORTER = "https://api.censusreporter.org/1.0/data/show/latest?table_ids=B02001&geo_ids=050%7C04000US{state}"
ATLAS = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"
ELECTION = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv"
CHR2022 = "https://www.countyhealthrankings.org/sites/default/files/media/document/analytic_data2022.csv"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/82/query"
# State FIPS codes: 50 states + DC + Puerto Rico
STATES = [f"{i:02d}" for i in range(1, 57) if i not in (3, 7, 14, 43, 52)] + ["72"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "swivel-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def main():
    out = {}
    for st in STATES:
        payload = get(REPORTER.format(state=st))
        for geoid, tables in payload["data"].items():
            est = tables["B02001"]["estimate"]
            total, black = est["B02001001"], est["B02001003"]
            fips = geoid.split("US")[1]
            if len(fips) != 5 or not total:
                continue
            name = payload["geography"][geoid]["name"]
            out[fips] = {"pct": round(black / total * 100, 1), "name": name}
        print(st, len(out))
    (OUT / "blackpop.json").write_text(json.dumps(out, separators=(",", ":")))

    topo = get(ATLAS)
    # Keep only the counties object (drop states/nation) to shrink the file
    topo["objects"] = {"counties": topo["objects"]["counties"]}
    (OUT / "counties.topo.json").write_text(json.dumps(topo, separators=(",", ":")))
    build_ct_regions()


def build_ct_regions():
    """Connecticut ACS data is keyed by planning region (since 2022), not the old counties in us-atlas."""
    q = urllib.parse.urlencode({
        "where": "STATE='09'", "outFields": "GEOID", "maxAllowableOffset": "0.003",
        "geometryPrecision": "4", "outSR": "4326", "f": "geojson",
    })
    gj = get(f"{TIGER}?{q}")
    for f in gj["features"]:
        f["id"] = f["properties"]["GEOID"]
        f["properties"] = {}
    (OUT / "ct_regions.json").write_text(json.dumps(gj, separators=(",", ":")))


def build_presidential():
    """Presidential results by county for 2016, 2020 and 2024 (tonmcg/US_County_Level_Election_Results_08-24).

    Writes src/data/pres2016.json, pres2020.json and pres2024.json. 2024 reports Connecticut by planning region.
    """
    import csv
    import io
    base = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master"
    for year in (2016, 2020, 2024):
        req = urllib.request.Request(f"{base}/{year}_US_County_Level_Presidential_Results.csv", headers={"User-Agent": "swivel-build"})
        with urllib.request.urlopen(req, timeout=120) as r:
            rows = csv.DictReader(io.StringIO(r.read().decode("utf-8")))
            out = {}
            for row in rows:
                if year == 2016:
                    fips, name = str(int(float(row["combined_fips"]))).zfill(5), f"{row['county_name']}, {row['state_abbr']}"
                else:
                    fips, name = row["county_fips"].zfill(5), f"{row['county_name']}, {row['state_name']}"
                gop, dem, total = (int(float(row[k])) for k in ("votes_gop", "votes_dem", "total_votes"))
                if not total:
                    continue
                out[fips] = {"name": name, "gop": gop, "dem": dem, "total": total, "margin": round((gop - dem) / total * 100, 1)}
        (OUT / f"pres{year}.json").write_text(json.dumps(out, separators=(",", ":")))
        print(year, len(out))


def build_violent_crime():
    """Violent crime rate per 100k by county from the County Health Rankings 2022 release.

    Later CHR releases dropped this measure; the underlying FBI data in this release is older.
    """
    import csv
    import io
    req = urllib.request.Request(CHR2022, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        reader = csv.DictReader(io.StringIO(r.read().decode("utf-8-sig")))
        next(reader)  # second header row holds variable codes
        out = {}
        for row in reader:
            fips, rate = row["5-digit FIPS Code"], row["Violent crime raw value"]
            if fips.endswith("000") or not rate:
                continue
            out[fips] = {"rate": round(float(rate)), "name": f"{row['Name']}, {row['State Abbreviation']}"}
    (OUT / "violentcrime.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
    build_presidential()
    build_violent_crime()
