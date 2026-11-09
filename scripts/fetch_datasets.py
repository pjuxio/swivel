"""Download national point datasets and save trimmed GeoJSON into src/data.

Usage: python3 scripts/fetch_datasets.py [name ...]
Names: hospital police fire_station urgent_care airport train_station prison military ice_office
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "data"
FEMA = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services"
NTAD = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services"


def clean(v):
    if v is None:
        return None
    v = str(v).strip()
    return v if v and v.upper() not in ("NOT AVAILABLE", "NA", "N/A", "-999") else None


def join_address(p, street="ADDRESS", city="CITY", state="STATE", zip_="ZIP"):
    parts = [clean(p.get(street)), clean(p.get(city)), clean(p.get(state)), clean(p.get(zip_))]
    return ", ".join(x for x in parts if x) or None


def facility(p, extra=()):
    return {
        "name": clean(p.get("NAME")) or "Unnamed",
        "address": join_address(p),
        "phone": clean(p.get("TELEPHONE")),
        "website": clean(p.get("WEBSITE")),
        "details": [[label, clean(p.get(k))] for label, k in extra if clean(p.get(k))],
    }


def airport(p):
    return {
        "name": clean(p.get("ARPT_NAME")) or "Unnamed",
        "address": join_address(p, street="CITY", city="STATE_NAME", state="COUNTRY_CODE", zip_="_"),
        "phone": clean(p.get("PHONE_NO")),
        "website": None,
        "details": [[l, clean(p.get(k))] for l, k in (("FAA ID", "ARPT_ID"), ("ICAO", "ICAO_ID")) if clean(p.get(k))],
    }


def amtrak(p):
    return {
        "name": clean(p.get("StationName")) or clean(p.get("Name")) or "Unnamed",
        "address": join_address(p, street="Address1", city="City", state="State", zip_="ZipCode"),
        "phone": None,
        "website": None,
        "details": [[l, clean(p.get(k))] for l, k in (("Station code", "Code"), ("Type", "StaType")) if clean(p.get(k))],
    }


def ice_office(p):
    return {
        "name": clean(p.get("Office_Name")) or "Unnamed",
        "address": " ".join((clean(p.get("Address")) or "").split()) or None,
        "phone": clean(p.get("Phone")),
        "website": None,
        "details": [["Area of responsibility", clean(p.get("Area_of_Responsibility"))]] if clean(p.get("Area_of_Responsibility")) else [],
    }


MIL_BRANCH = {
    "usa": "Army", "usar": "Army Reserve", "armyNationalGuard": "Army National Guard", "usn": "Navy",
    "usnr": "Navy Reserve", "usaf": "Air Force", "afr": "Air Force Reserve", "airNationalGuard": "Air National Guard",
    "usmc": "Marine Corps", "usmcr": "Marine Corps Reserve", "whs": "Washington Headquarters Services",
}
MIL_STATUS = {"act": "Active", "care": "Caretaker", "clsd": "Closed", "semi": "Semi-active", "excs": "Excess"}


def military(p):
    branch, status = clean(p.get("siteReportingComponent")), clean(p.get("siteOperationalStatus"))
    state = clean(p.get("stateNameCode"))
    return {
        "name": clean(p.get("siteName")) or clean(p.get("featureName")) or "Unnamed",
        "address": state.upper() if state else None,
        "phone": None,
        "website": None,
        "details": [[l, v] for l, v in (
            ("Branch", MIL_BRANCH.get(branch, branch)), ("Status", MIL_STATUS.get(status, status)),
        ) if v],
    }


DATASETS = {
    "hospital": dict(
        url=f"{FEMA}/Hospitals_hifld/FeatureServer/0",
        where="STATUS='OPEN'",
        map=lambda p: facility(p, (("Type", "TYPE"), ("Beds", "BEDS"), ("Trauma", "TRAUMA"), ("Helipad", "HELIPAD"))),
    ),
    "police": dict(
        url=f"{FEMA}/Local_Law_Enforcement_Locations_RAPT/FeatureServer/0",
        where="STATUS='OPEN' OR STATUS IS NULL",
        map=lambda p: facility(p, (("Type", "TYPE"),)),
    ),
    "fire_station": dict(
        url=f"{FEMA}/Critical_Infrastructure_Map_Service/FeatureServer/12",
        where="1=1",
        map=lambda p: facility(p, (("Type", "TYPE"),)),
    ),
    "urgent_care": dict(
        url="https://services1.arcgis.com/wQnFk5ouCfPzTlPw/arcgis/rest/services/Urgent_Care_Facilities/FeatureServer/0",
        where="1=1",
        map=facility,
    ),
    "airport": dict(
        url=f"{NTAD}/NTAD_Aviation_Facilities/FeatureServer/0",
        where="SITE_TYPE_CODE='A' AND ARPT_STATUS='O' AND FACILITY_USE_CODE='PU'",
        map=airport,
    ),
    "prison": dict(
        url=f"{FEMA}/Prison_Points/FeatureServer/0",
        where="STATUS='OPEN' OR STATUS IS NULL",
        map=lambda p: facility(p, (("Type", "TYPE"), ("Security level", "SECURELVL"), ("Population", "POPULATION"), ("Capacity", "CAPACITY"))),
    ),
    "military": dict(
        url=f"{NTAD}/NTAD_Military_Bases/FeatureServer/0",
        where="1=1",
        centroid=True,
        map=military,
    ),
    "ice_office": dict(
        url="https://services8.arcgis.com/OaGD4UoLmJKrKXBG/arcgis/rest/services/ICE_Enforcement_and_Removal_Operations_(ERO)_Field_Offices/FeatureServer/0",
        where="1=1",
        map=ice_office,
    ),
    "train_station": dict(
        url=f"{NTAD}/NTAD_Amtrak_Stations/FeatureServer/0",
        where="StnType='TRAIN'",
        map=amtrak,
    ),
}


def query(url, params):
    full = f"{url}/query?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(full, timeout=120) as r:
        return json.load(r)


def fetch(name, cfg):
    feats, offset = [], 0
    with urllib.request.urlopen(f"{cfg['url']}?f=json", timeout=60) as r:
        meta = json.load(r)
    oid = next(f["name"] for f in meta["fields"] if f["type"] == "esriFieldTypeOID")
    while True:
        d = query(
            cfg["url"],
            {"where": cfg["where"], "outFields": "*", "outSR": 4326, "f": "json",
             "resultOffset": offset, "resultRecordCount": 1000, "orderByFields": oid,
             **({"returnCentroid": "true", "returnGeometry": "false"} if cfg.get("centroid") else {})},
        )
        if "error" in d:
            raise RuntimeError(f"{name}: {d['error']}")
        batch = d.get("features", [])
        for f in batch:
            g = f.get("centroid") or f.get("geometry") or {}
            if "x" not in g or not (-180 <= g["x"] <= 180) or not (-90 <= g["y"] <= 90):
                continue
            props = cfg["map"](f["attributes"])
            props["id"] = f"{name}/{f['attributes'].get(oid)}"
            props = {k: v for k, v in props.items() if v not in (None, [])}
            feats.append({"type": "Feature", "properties": props,
                          "geometry": {"type": "Point", "coordinates": [round(g["x"], 5), round(g["y"], 5)]}})
        offset += len(batch)
        if not batch or not d.get("exceededTransferLimit"):
            break
    return feats


if __name__ == "__main__":
    names = sys.argv[1:] or list(DATASETS)
    OUT.mkdir(parents=True, exist_ok=True)
    for n in names:
        feats = fetch(n, DATASETS[n])
        path = OUT / f"{n}.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
        print(f"{n}: {len(feats)} features, {path.stat().st_size / 1e6:.1f} MB")
