# ACE Data Pipeline

Three sources → one DataFrame. Run once, commit nothing but scripts.

## Setup

```bash
cd data_pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`.env` (in repo root) must contain:

```
UCSB_API_KEY=...
```

## Run in order

```bash
python scripts/01_fetch_nexus_grades.py         # ~2s, downloads courseGrades.csv
python scripts/02_fetch_ucsb_catalog.py         # ~30s, one quarter of sections
python scripts/03_fetch_rmp.py --limit 25       # sanity-check RMP first
python scripts/03_fetch_rmp.py                  # full scrape, ~10 min
python scripts/04_merge.py                      # produces processed/unified.csv
```

## Outputs

- `raw/nexus_grades.csv` — every graded UCSB course instance, Fall 2009 → today
- `raw/ucsb_catalog_<quarter>.csv` — live sections for one quarter (incl. times, enroll counts, profs)
- `raw/rmp_cache.json` + `raw/rmp_ratings.csv` — cached RMP lookups per unique Nexus instructor
- `processed/unified.csv` — the one DataFrame that feeds modeling

## Grain of the final DataFrame

One row per historical (course × instructor × quarter × year), with:

- Grade distribution (counts + percentages + `avgGPA`)
- RMP fields (`rmp_rating`, `rmp_difficulty`, `rmp_num_ratings`, `rmp_would_take_again`) — NULL where unmatched
- Catalog fields for the target quarter (title, description, units, GE codes) — only populated where that instructor is teaching that course this quarter

## Known limitations

1. **RMP name matching.** Nexus stores `LASTNAME F M`. We query RMP as `F Lastname` and rely on their fuzzy search. Expect ~60-75% match rate. Unmatched professors get NULL — the downstream model must handle that.
2. **Catalog coverage.** Catalog only has currently-offered classes. Historical rows where the prof+course isn't in the current quarter will have NULL catalog fields. That's fine — we use catalog data for prospective schedule building, not for training the grade predictor.
3. **Nexus omits <5-enroll sections.** Long tail of seminars won't have grade data. Also fine.
