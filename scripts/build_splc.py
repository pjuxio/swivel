"""Geocode splc_hate_data_2025.csv against the Census gazetteer and write server/data/splc_hate.geojson.

The CSV has only state and city, so pins are placed at the city (or county) centroid.
Rows flagged statewide have no city and are skipped.
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAZ = Path(__file__).resolve().parent / "gazetteer"

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA",
    "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
    "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
SUFFIX = re.compile(
    r"\s+(city|town|village|borough|municipality|cdp|township|plantation|city and borough|urban county|"
    r"consolidated government|metropolitan government|unified government|\(balance\)|"
    r"consolidated government \(balance\)|metro government \(balance\)|zona urbana|comunidad)$",
    re.I,
)


# Neighborhoods and misspellings that the gazetteer's incorporated-place list can't match
ALIASES = {
    ("CA", "Sherman Oaks"): "Los Angeles", ("CA", "Encino"): "Los Angeles", ("CA", "Sacremento"): "Sacramento",
    ("CO", "Colorado Spring"): "Colorado Springs", ("MO", "O'Fallen"): "O'Fallon",
    ("NY", "Brooklyn"): "New York", ("NY", "Long Island City"): "New York", ("NY", "Oakland Gardens"): "New York",
    ("MI", "Mt Pleasant"): "Mount Pleasant", ("FL", "Melbou"): "Melbourne",
}


def norm(s):
    s = s.lower().replace("saint ", "st ").replace("st. ", "st ").replace("ft. ", "fort ").replace("mt. ", "mount ")
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def base_name(s):
    prev = None
    while prev != s:
        prev, s = s, SUFFIX.sub("", s.strip())
    return norm(s)


places = defaultdict(list)  # (state, name) -> [(population proxy = land area, lat, lon)]
for row in csv.DictReader(open(GAZ / "2023_Gaz_place_national.txt", encoding="utf-8"), delimiter="\t"):
    row = {k.strip(): v.strip() for k, v in row.items()}
    places[(row["USPS"], base_name(row["NAME"]))].append((float(row["ALAND"]), float(row["INTPTLAT"]), float(row["INTPTLONG"])))

counties = {}
for row in csv.DictReader(open(GAZ / "2023_Gaz_counties_national.txt", encoding="utf-8"), delimiter="\t"):
    row = {k.strip(): v.strip() for k, v in row.items()}
    n = re.sub(r"\s+(county|parish|borough|census area|municipality|city and borough)$", "", row["NAME"], flags=re.I)
    counties.setdefault((row["USPS"], norm(n)), (float(row["INTPTLAT"]), float(row["INTPTLONG"])))

features, skipped, unmatched = [], 0, []
for i, r in enumerate(csv.DictReader(open(ROOT / "splc_hate_data_2025.csv", encoding="utf-8-sig"))):
    if r["statewide"] == "true" or r["city_name"] in ("", "undefined"):
        skipped += 1
        continue
    st = STATES[r["state_name"]]
    city = re.sub(r"^(town|city|village) of\s+", "", r["city_name"].strip(), flags=re.I)
    city = ALIASES.get((st, city), city)
    key = (st, base_name(city))
    hit = max(places[key])[1:] if key in places else None
    precision = "city"
    if not hit:
        ckey = (st, norm(re.sub(r"\s+(county|parish|borough)$", "", city, flags=re.I)))
        hit = counties.get(ckey)
        precision = "county"
    if not hit:
        unmatched.append((r["name"], city, st))
        continue
    features.append({
        "type": "Feature",
        "properties": {
            "id": f"splc/{i}",
            "name": r["name"],
            "address": f"{city}, {st}",
            "details": [["Ideology", r["ideology_name"]], ["Location precision", f"{precision} centroid"]]
            + ([["EIN", r["ein"]]] if r["ein"] else []),
        },
        "geometry": {"type": "Point", "coordinates": [round(hit[1], 5), round(hit[0], 5)]},
    })

out = ROOT / "server" / "data" / "splc_hate.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
print(f"placed {len(features)}, statewide/no-city skipped {skipped}, unmatched {len(unmatched)}")
for u in unmatched[:40]:
    print("  unmatched:", u)
