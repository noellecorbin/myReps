import asyncio
import datetime as dt
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Elected Officials Lookup")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
ZIPPOPOTAM = "https://api.zippopotam.us/us/{zip}"
LEGISLATORS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
BALLOTWATCH = "https://www.ballotwatch.io/api/v1"

_legislators_cache: list[dict] | None = None


async def get_legislators(client: httpx.AsyncClient) -> list[dict]:
    global _legislators_cache
    if _legislators_cache is None:
        resp = await client.get(LEGISLATORS_URL, timeout=30)
        resp.raise_for_status()
        _legislators_cache = resp.json()
    return _legislators_cache


def term_is_current(term: dict) -> bool:
    today = dt.date.today().isoformat()
    return term.get("start", "") <= today <= term.get("end", "9999-12-31")


def official_from_legislator(leg: dict, term: dict) -> dict:
    is_sen = term.get("type") == "sen"
    bioguide = (leg.get("id") or {}).get("bioguide")
    name = leg.get("name") or {}
    return {
        "bioguide": bioguide,
        "name": name.get("official_full") or f"{name.get('first', '')} {name.get('last', '')}".strip(),
        "role": "Senator" if is_sen else "Representative",
        "party": term.get("party"),
        "state": term.get("state"),
        "district": term.get("district"),
        "officialWebsite": term.get("url"),
        "contactUrl": term.get("contact_form"),
        "photoUrl": (
            f"https://unitedstates.github.io/images/congress/225x275/{bioguide}.jpg"
            if bioguide
            else None
        ),
    }


async def lookup_geography(client: httpx.AsyncClient, zip_code: str) -> dict:
    zp_resp = await client.get(ZIPPOPOTAM.format(zip=zip_code), timeout=15)
    if zp_resp.status_code != 200:
        raise HTTPException(status_code=404, detail="No location found for that ZIP code")
    places = zp_resp.json().get("places") or []
    if not places:
        raise HTTPException(status_code=404, detail="No location found for that ZIP code")

    place = places[0]
    city = place.get("place name")
    state_abbr = place.get("state abbreviation")

    resp = await client.get(
        CENSUS_GEOCODER,
        params={
            "x": place["longitude"],
            "y": place["latitude"],
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "format": "json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json().get("result", {})
    geos = result.get("geographies") or {}
    if not geos:
        matches = result.get("addressMatches") or []
        geos = matches[0].get("geographies", {}) if matches else {}
    if not geos:
        raise HTTPException(status_code=404, detail="No location found for that ZIP code")

    states = geos.get("States") or []
    cd_districts = next(
        (v for k, v in geos.items() if "Congressional Districts" in k), None
    ) or []
    if not states:
        raise HTTPException(status_code=404, detail="No location found for that ZIP code")

    state = states[0]
    state_name = state.get("NAME")
    cd = None
    if cd_districts:
        cd = next(
            (
                v
                for k, v in cd_districts[0].items()
                if k.startswith("CD") and k[2:].isdigit()
            ),
            None,
        )
    county = (geos.get("Counties") or [{}])[0].get("NAME")

    return {
        "zip": zip_code,
        "city": city,
        "stateAbbr": state_abbr,
        "stateName": state_name,
        "county": county,
        "congressionalDistrict": cd,
    }


@app.get("/api/officials")
async def get_officials(zip: str = Query(..., min_length=5, max_length=10)):
    zip_code = zip.strip()
    if not zip_code.isdigit():
        raise HTTPException(status_code=400, detail="ZIP code must contain only digits")

    async with httpx.AsyncClient() as client:
        geo = await lookup_geography(client, zip_code)
        legislators = await get_legislators(client)

    state = geo["stateAbbr"]
    try:
        district_num = int(geo["congressionalDistrict"])
    except (TypeError, ValueError):
        district_num = None

    officials = []
    for leg in legislators:
        for term in leg.get("terms") or []:
            if not term_is_current(term) or term.get("state") != state:
                continue
            ttype = term.get("type")
            if ttype == "sen":
                officials.append(official_from_legislator(leg, term))
            elif ttype in ("rep", "del", "repNonvoting") and (
                term.get("district") == district_num
                or (district_num == 98 and term.get("district") == 0)
            ):
                officials.append(official_from_legislator(leg, term))

    if not officials:
        raise HTTPException(status_code=404, detail="No officials found for that ZIP code")

    return {
        "zip": zip_code,
        "location": {
            "city": geo["city"],
            "stateAbbr": state,
            "stateName": geo["stateName"],
            "county": geo["county"],
            "congressionalDistrict": geo["congressionalDistrict"],
        },
        "officials": officials,
    }


def years_between(start: str, end: str) -> float:
    try:
        s = dt.date.fromisoformat(start)
        e = dt.date.fromisoformat(end) if end else dt.date.today()
    except ValueError:
        return 0.0
    return round(max((e - s).days / 365.25, 0.0), 1)


def build_term_history(leg: dict) -> list[dict]:
    terms = sorted(leg.get("terms") or [], key=lambda t: t.get("start", ""))
    history = []
    for t in terms:
        is_sen = t.get("type") == "sen"
        history.append(
            {
                "chamber": "Senate" if is_sen else ("House" if t.get("type") == "rep" else t.get("type")),
                "state": t.get("state"),
                "district": t.get("district"),
                "party": t.get("party"),
                "start": t.get("start"),
                "end": t.get("end"),
                "current": term_is_current(t),
                "years": years_between(t.get("start", ""), t.get("end") or dt.date.today().isoformat()),
            }
        )
    return history


async def ballotwatch_get(client: httpx.AsyncClient, path: str) -> dict | None:
    try:
        resp = await client.get(f"{BALLOTWATCH}{path}", timeout=20)
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        pass
    return None


@app.get("/api/official/{bioguide}")
async def get_official(bioguide: str):
    bioguide = bioguide.strip().upper()
    async with httpx.AsyncClient() as client:
        legislators = await get_legislators(client)
        leg = next(
            (
                l
                for l in legislators
                if (l.get("id") or {}).get("bioguide") == bioguide
            ),
            None,
        )
        if leg is None:
            raise HTTPException(status_code=404, detail="Official not found")

        stats_resp, votes_resp = await _gather_bw(client, bioguide)

    terms = leg.get("terms") or []
    current_terms = [t for t in terms if term_is_current(t)]
    current = max(current_terms, key=lambda t: t.get("start", ""), default=None)

    history = build_term_history(leg)
    total_years = round(sum(h["years"] for h in history), 1)

    stats = None
    if stats_resp:
        entries = (stats_resp.get("data") or {}).get("stats") or []
        if entries:
            s = max(entries, key=lambda e: e.get("congress", 0))
            stats = {
                "congress": s.get("congress"),
                "totalVotes": s.get("total_votes"),
                "yea": s.get("yea_count"),
                "nay": s.get("nay_count"),
                "present": s.get("present_count"),
                "notVoting": s.get("not_voting_count"),
                "partyLoyaltyPct": s.get("party_loyalty_pct"),
            }

    votes = []
    if votes_resp:
        for v in votes_resp.get("data") or []:
            bill = v.get("bill") or {}
            votes.append(
                {
                    "date": v.get("voted_at"),
                    "position": v.get("position"),
                    "billId": bill.get("id"),
                    "billTitle": bill.get("title"),
                    "billUrl": bill.get("source_url"),
                    "policyArea": bill.get("policy_area"),
                    "rollCallUrl": v.get("source_url"),
                }
            )

    name = leg.get("name") or {}
    bio = leg.get("bio") or {}
    ids = leg.get("id") or {}

    return {
        "bioguide": bioguide,
        "name": official_from_legislator(leg, current)["name"] if current else (
            name.get("official_full")
            or f"{name.get('first', '')} {name.get('last', '')}".strip()
        ),
        "role": "Senator" if current and current.get("type") == "sen" else "Representative",
        "party": (current or {}).get("party"),
        "state": (current or {}).get("state"),
        "district": (current or {}).get("district"),
        "photoUrl": (
            f"https://unitedstates.github.io/images/congress/225x275/{bioguide}.jpg"
        ),
        "officialWebsite": (current or {}).get("url"),
        "contactUrl": (current or {}).get("contact_form"),
        "birthday": bio.get("birthday"),
        "gender": bio.get("gender"),
        "totalYears": total_years,
        "terms": history,
        "votingStats": stats,
        "recentVotes": votes,
        "sources": {
            "congress": f"https://www.congress.gov/member/{bioguide}",
            "wikipedia": (
                f"https://en.wikipedia.org/wiki/{quote(ids['wikipedia'])}"
                if ids.get("wikipedia")
                else None
            ),
        },
    }


async def _gather_bw(client: httpx.AsyncClient, bioguide: str):
    return await asyncio.gather(
        ballotwatch_get(client, f"/members/{bioguide}/stats"),
        ballotwatch_get(client, f"/members/{bioguide}/votes?limit=25"),
    )


EXECUTIVE_OFFICIALS = [
    {
        "role": "President of the United States",
        "name": "Donald J. Trump",
        "party": "Republican",
        "term": "2025–2029",
        "photo": "Official_Presidential_Portrait_of_President_Donald_J._Trump_(2025).jpg",
        "wikipedia": "Donald Trump",
        "whitehouse": "https://www.whitehouse.gov/administration/donald-j-trump/",
    },
    {
        "role": "Vice President of the United States",
        "name": "JD Vance",
        "party": "Republican",
        "term": "2025–2029",
        "photo": "March_2026_Official_Vice_Presidential_Portrait_of_JD_Vance_(medium_crop)_(2).jpg",
        "wikipedia": "JD Vance",
        "whitehouse": "https://www.whitehouse.gov/administration/jd-vance/",
    },
]


def commons_file_url(filename: str) -> str:
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(filename)}?width=400"


@app.get("/api/executive")
async def get_executive():
    officials = [
        {
            "role": o["role"],
            "name": o["name"],
            "party": o["party"],
            "term": o["term"],
            "photoUrl": commons_file_url(o["photo"]),
            "officialWebsite": o["whitehouse"],
            "wikipediaUrl": f"https://en.wikipedia.org/wiki/{quote(o['wikipedia'].replace(' ', '_'))}",
        }
        for o in EXECUTIVE_OFFICIALS
    ]
    return {"officials": officials}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
