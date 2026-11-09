"""Build county mobile broadband coverage into src/data/mobile.json.

Input: the FCC Broadband Data Collection "bdc_us_mobile_broadband_summary_by_geography_*.zip"
(free download from the FCC National Broadband Map data page), placed in the project root.
Values are the percent of each county's land area with coverage, for 4G LTE and 5G-NR
(5G spd1 = 35/3 Mbps), stationary and in-vehicle.

Usage: python3 scripts/build_mobile.py [path/to/zip]
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "mobile.json"


def pct(v):
    return round(float(v) * 100, 1) if v not in ("", None) else None


def main(path=None):
    zpath = Path(path) if path else sorted(ROOT.glob("bdc_us_mobile_broadband_summary_by_geography_*.zip"))[-1]
    z = zipfile.ZipFile(zpath)
    rows = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8"))
    out = {}
    for r in rows:
        if r["geography_type"] != "County" or r["area_data_type"] != "Total":
            continue
        out[r["geography_id"]] = {
            "name": r["geography_desc"],
            "g4": pct(r["mobilebb_4g_area_st_pct"]),
            "g4v": pct(r["mobilebb_4g_area_iv_pct"]),
            "g5": pct(r["mobilebb_5g_spd1_area_st_pct"]),
            "g5v": pct(r["mobilebb_5g_spd1_area_iv_pct"]),
        }
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(zpath.name, len(out), "counties; CT:", sorted(k for k in out if k.startswith("09")))


if __name__ == "__main__":
    main(*sys.argv[1:])
