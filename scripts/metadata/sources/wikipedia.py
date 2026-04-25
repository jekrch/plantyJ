"""Wikipedia enrichment — pull the lead section as `description`."""
import re
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_WIKIPEDIA, ensure_reference, has_source, mark_source
from ..seed import save_species
from ..text import is_meaningful_description

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_PORTAL = "https://en.wikipedia.org/wiki/{title}"


def fetch_wikipedia_intro(title: str, health: IntegrationHealth) -> str | None:
    params = {
        "action": "query",
        "titles": title.replace("_", " "),
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "redirects": 1,
        "format": "json",
    }
    try:
        resp = requests.get(
            WIKI_API,
            params=params,
            headers={"User-Agent": "plantyj/1.0"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"  WARN: Wikipedia fetch failed for {title}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: Wikipedia fetch failed for {title}: {e}", file=sys.stderr)
        return None

    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    if "missing" in page:
        return None

    text = page.get("extract", "") or ""
    if not text:
        return None
    text = re.sub(r"\[[\w\s]*\d+\]", "", text)
    text = re.sub(r"  +", " ", text).strip()
    return text


def backfill_wikipedia(species_entries: list[dict]) -> int:
    health = IntegrationHealth("Wikipedia")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_WIKIPEDIA):
            continue
        if entry.get("description"):
            mark_source(entry, SOURCE_WIKIPEDIA)
            save_species(entry)
            continue

        full_name = entry.get("fullName")
        if not full_name:
            continue

        # Strip cultivar suffix for Wikipedia title (Wikipedia rarely has
        # cultivar pages — it almost always has the base species).
        base_name = re.sub(r"\s*'[^']+'\s*$", "", full_name).strip()

        print(f"  Wikipedia lookup: {base_name}")
        intro = fetch_wikipedia_intro(base_name, health)
        if intro and is_meaningful_description(intro):
            entry["description"] = intro
            ensure_reference(
                entry,
                "Wikipedia",
                WIKI_PORTAL.format(title=base_name.replace(" ", "_")),
            )

        mark_source(entry, SOURCE_WIKIPEDIA)
        save_species(entry)
        updated += 1
        time.sleep(0.5)

    return updated
