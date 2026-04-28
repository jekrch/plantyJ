# Source identifiers for tracking which sources have processed an entry
SOURCE_WIKIPEDIA = "wikipedia"
SOURCE_GBIF = "gbif"
SOURCE_POWO = "powo"
SOURCE_INATURALIST = "inaturalist"
SOURCE_WIKIDATA = "wikidata"
SOURCE_NATURESERVE = "natureserve"

def has_source(entry: dict, source_id: str) -> bool:
    return source_id in entry.get("sources", [])


def mark_source(entry: dict, source_id: str) -> None:
    sources = entry.setdefault("sources", [])
    if source_id not in sources:
        sources.append(source_id)


def ensure_reference(entry: dict, name: str, url: str) -> None:
    refs = entry.setdefault("references", [])
    for ref in refs:
        if (ref.get("name") or "").strip().lower() == name.strip().lower():
            return
    refs.append({"name": name, "url": url})
