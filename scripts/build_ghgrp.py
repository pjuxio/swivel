"""Build EPA GHGRP facility emissions into src/data/ghgrp.geojson.

Source: EPA Greenhouse Gas Reporting Program "Direct Point Emitters" sheet, reporting year 2023
(https://www.epa.gov/ghgreporting/ghgrp-emissions-location, data sets page ->
2023_data_summary_spreadsheets.zip -> ghgp_data_2023.xlsx). Requires openpyxl.

Usage: python3 scripts/build_ghgrp.py
"""
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "ghgrp.geojson"
URL = "https://www.epa.gov/system/files/other-files/2024-10/2023_data_summary_spreadsheets.zip"
YEAR = 2023


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    wb = openpyxl.load_workbook(io.BytesIO(z.read(f"ghgp_data_{YEAR}.xlsx")), read_only=True)
    rows = wb["Direct Point Emitters"].iter_rows(values_only=True)
    header = None
    for row in rows:
        if row and row[0] == "Facility Id":
            header = [str(h).strip() if h else "" for h in row]
            break
    col = {h: i for i, h in enumerate(header)}

    feats = []
    for row in rows:
        if not row or row[0] is None or row[col["Latitude"]] is None or row[col["Longitude"]] is None:
            continue
        total = row[col["Total reported direct emissions"]]
        co2e = round(float(total)) if total not in (None, "") else None
        county = (row[col["County"]] or "").title()
        city, state, zip_ = row[col["City"]], row[col["State"]], row[col["Zip Code"]]
        address = ", ".join(str(x) for x in (row[col["Address"]], city, state, zip_) if x)
        details = []
        if co2e is not None:
            details.append(["Emissions", f"{co2e:,} t CO2e ({YEAR})"])
        if row[col["Industry Type (sectors)"]]:
            details.append(["Industry", str(row[col["Industry Type (sectors)"]])])
        if county:
            details.append(["County", county])
        feats.append({
            "type": "Feature",
            "properties": {
                "id": f"ghgrp/{row[0]}",
                "name": str(row[col["Facility Name"]]).strip(),
                "address": address or None,
                "details": details,
            },
            "geometry": {"type": "Point", "coordinates": [round(float(row[col["Longitude"]]), 5), round(float(row[col["Latitude"]]), 5)]},
        })
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    print(len(feats), "facilities,", round(OUT.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
