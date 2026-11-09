"""Build FBI hate crime incidents by county into src/data/hatecrime.json.

Sources (both public, no key):
  - FBI Crime Data Explorer bulk download hate_crime.zip (incident level, reported by police agency)
  - FBI CDE agency list per state, which gives each agency's county name(s)
Counties are matched to FIPS by name using src/data/pres2020.json; population comes from src/data/acs.json
(run build_acs.py first). Incidents are summed over 2020-2024 and divided by 5 years of population.

Caveat: reporting is voluntary and by agency, so counties with few reporting agencies undercount.

Usage: python3 scripts/build_hatecrime.py
"""
import csv
import io
import json
import re
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"
YEARS = range(2020, 2025)
UA = {"User-Agent": "Mozilla/5.0"}
STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK "
          "OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


def norm(name):
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().replace(".", "").replace("'", "")
    n = re.sub(r"\bsaint\b", "st", n)
    n = re.sub(r"\bsainte\b", "ste", n)
    n = re.sub(r"\b(county|parish|borough|census area|municipality|city and borough)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def main():
    index = {}
    # 2020 results use Connecticut's old counties; 2024 uses the planning regions that the map shapes and ACS use
    for fname, skip_ct in (("pres2020.json", True), ("pres2024.json", False)):
        for fips, v in json.loads((DATA / fname).read_text()).items():
            if skip_ct == (fips[:2] == "09") and fname == "pres2020.json":
                continue
            if fname == "pres2024.json" and fips[:2] != "09":
                continue
            county, state = v["name"].rsplit(", ", 1)
            index[(fips[:2], norm(county))] = (fips, v["name"])
    st_fips = {}
    for fips, v in json.loads((DATA / "pres2020.json").read_text()).items():
        st_fips[v["name"].rsplit(", ", 1)[1].lower()] = fips[:2]
    pop = {k: v["pop"] for k, v in json.loads((DATA / "acs.json").read_text()).items() if v.get("pop")}

    url = list(json.loads(get("https://cde.ucr.cjis.gov/LATEST/s3/signedurl?key=additional-datasets/hate-crime/hate_crime.zip")).values())[0]
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    counts, state_of = defaultdict(int), {}
    for row in csv.DictReader(io.TextIOWrapper(z.open("hate_crime.csv"), encoding="utf-8")):
        if int(row["data_year"]) in YEARS:
            counts[row["ori"]] += 1
            state_of[row["ori"]] = row["state_name"].lower()

    by_county = defaultdict(int)
    unmatched = defaultdict(int)
    for st in STATES:
        agencies = json.loads(get(f"https://cde.ucr.cjis.gov/LATEST/agency/byStateAbbr/{st}"))
        time.sleep(0.3)
        for county_label, rows in agencies.items():
            for a in rows:
                n = counts.get(a["ori"])
                if not n:
                    continue
                names = [c.strip() for c in re.split(r"[;,]", county_label) if c.strip()]
                if a["state_abbr"] == "DC":
                    names = ["District of Columbia"]
                elif a["ori"] == "NY0303000":  # NYPD covers the five boroughs
                    names = ["Bronx", "Kings", "New York", "Queens", "Richmond"]
                sf = st_fips.get(a["state_name"].lower())
                hits = [index[(sf, norm(c))] for c in names if (sf, norm(c)) in index]
                if not hits:
                    unmatched[f"{county_label}, {st}"] += n
                    continue
                # agencies spanning several counties are split by population
                total_pop = sum(pop.get(f, 0) for f, _ in hits) or len(hits)
                for fips, _ in hits:
                    by_county[fips] += n * ((pop.get(fips, 0) or 1) / total_pop if total_pop != len(hits) else 1 / len(hits))

    out = {}
    for fips, n in by_county.items():
        p = pop.get(fips)
        if not p:
            continue
        name = next(v[1] for v in index.values() if v[0] == fips)
        out[fips] = {"name": name, "incidents": round(n), "rate": round(n / (p * len(YEARS)) * 100000, 1), "pop": p}
    (DATA / "hatecrime.json").write_text(json.dumps(out, separators=(",", ":")))
    lost = sum(unmatched.values())
    print(len(out), "counties;", round(sum(by_county.values())), "incidents matched;", lost, "unmatched:", sorted(unmatched.items(), key=lambda x: -x[1])[:12])


if __name__ == "__main__":
    main()
