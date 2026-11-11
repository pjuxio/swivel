"""Build the Sundown Towns map data into server/data/sundown_towns.geojson.

Source: History and Social Justice / Sundown Towns Database, Tougaloo College (James W. Loewen, Susan Berrey
and contributors) - https://justice.tougaloo.edu/map/. The data is the public JSON feed that their own map loads
(/wp-json/sundowntowns/geojson). Be gentle with it: this runs rarely, pages sequentially and pauses between requests.
Credit the source wherever the data is shown, and contact them before wider redistribution.

Usage: python3 scripts/build_sundown.py
"""
import json
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "server" / "data" / "sundown_towns.geojson"
URL = "https://justice.tougaloo.edu/wp-json/sundowntowns/geojson?per-page={n}&offset={off}"
PAGE = 125
UA = {"User-Agent": "swivel-build (research use; contact repo owner)"}

# Mirrors the legend on the source map
STATUS = {
    0: "Don't know", 1: "Unlikely", 2: "Possible", 3: "Probable", 4: "Surely",
    8: "Unlikely / always biracial", 9: "Black town or township",
}
# The other statuses are places the database judged not to be sundown towns, so they are left out
KEEP = {"Possible", "Probable", "Surely"}


def in_us(lon, lat):
    """Rough boxes around the states and territories; catches 0,0 and points geocoded to the wrong country."""
    boxes = [(24.3, 49.5, -125, -66.9), (51, 71.6, -180, -129.9), (51, 53, 172, 180), (18.8, 22.4, -160.6, -154.7),
             (17.6, 18.6, -67.4, -64.5), (13.2, 20.6, 144.5, 146.1), (-14.6, -11, -171.2, -168.1)]
    return any(a <= lat <= b and c <= lon <= d for a, b, c, d in boxes)


def get(offset):
    req = urllib.request.Request(URL.format(n=PAGE, off=offset), headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    feats, offset = [], 0
    while True:
        batch = get(offset)
        if not batch:
            break
        feats.extend(batch)
        offset += PAGE
        time.sleep(1)

    out = []
    for f in feats:
        p, g = f["properties"], f.get("geometry") or {}
        if g.get("type") != "Point" or p.get("name") is None:
            continue
        status = STATUS.get(p.get("confirmed") or 0, "Don't know")
        lon, lat = g["coordinates"][:2]
        if status not in KEEP or not in_us(lon, lat):
            continue
        town = p["name"].strip()
        state = (p.get("state") or "").strip()
        out.append({
            "type": "Feature",
            "properties": {
                "id": f"sundown/{f['id']}",
                "name": f"{town}, {state} ({status})" if state else f"{town} ({status})",  # status shows in the results list
                "website": p.get("permalink"),
                "details": [["Sundown town?", status], ["Source", "Tougaloo College Sundown Towns Database"]],
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        })
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
    counts = {}
    for o in out:
        k = o["properties"]["details"][0][1]
        counts[k] = counts.get(k, 0) + 1
    print(len(out), "towns,", round(OUT.stat().st_size / 1e6, 2), "MB;", counts)


if __name__ == "__main__":
    main()
