"""
Normalized Taxonomy Registry Builder.

Scans all species entries for unique higher-level taxa (kingdom through genus),
checks them against a global taxa.json registry, and fetches missing 
descriptions/URLs from the Wikipedia REST API.
"""
import json
import sys
import time
import requests

from ..health import IntegrationHealth
from ..paths import TAXA_PATH

WIKI_SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"

def fetch_taxon_summary(name: str, health: IntegrationHealth) -> dict | None:
    try:
        resp = requests.get(
            WIKI_SUMMARY_API.format(title=name),
            headers={"User-Agent": "plantyj/1.0 (metadata-bot)"},
            timeout=5
        )
        if resp.status_code == 429:
            health.mark_throttled("rate limited (429)")
            return None
        if resp.status_code == 200:
            data = resp.json()
            return {
                "description": data.get("extract"),
                "url": data.get("content_urls", {}).get("desktop", {}).get("page")
            }
    except requests.exceptions.Timeout:
        health.mark_throttled("Wikipedia taxonomy timed out")
    except Exception as e:
        print(f"  WARN: Taxon lookup failed for {name}: {e}", file=sys.stderr)
        
    return None

def build_taxa_registry(species_entries: list[dict]) -> int:
    health = IntegrationHealth("TaxaRegistry")
    
    # Load the existing registry to act as our cache
    taxa_registry = {}
    if TAXA_PATH.exists():
        try:
            taxa_registry = json.loads(TAXA_PATH.read_text())
        except json.JSONDecodeError:
            print("  WARN: taxa.json is malformed, starting fresh.", file=sys.stderr)

    # 1. Harvest all unique taxa names from the species entries
    ranks_to_collect = ["kingdom", "phylum", "class", "order", "family", "genus"]
    unique_taxa = set()
    
    for entry in species_entries:
        taxonomy = entry.get("taxonomy")
        if not taxonomy:
            continue
            
        for rank in ranks_to_collect:
            taxon_name = taxonomy.get(rank)
            if isinstance(taxon_name, str) and taxon_name.strip():
                unique_taxa.add(taxon_name.strip())

    # 2. Fetch data for any taxa not already in our registry
    added_count = 0
    for taxon in sorted(unique_taxa):
        if health.should_bail:
            break
            
        if taxon in taxa_registry:
            continue  # Already fetched previously
            
        print(f"  Taxa lookup: {taxon}")
        summary = fetch_taxon_summary(taxon, health)
        
        # Save the result (even if None, to prevent repeated failed lookups)
        taxa_registry[taxon] = summary if summary else {"description": None, "url": None}
        added_count += 1
        time.sleep(0.2)

    # 3. Write the updated registry to disk if changes were made
    if added_count > 0:
        TAXA_PATH.parent.mkdir(parents=True, exist_ok=True)
        TAXA_PATH.write_text(json.dumps(taxa_registry, indent=2) + "\n")
        
    return added_count