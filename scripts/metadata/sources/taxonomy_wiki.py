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
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            # Wikipedia strongly prefers User-Agents with an email address
            resp = requests.get(
                WIKI_SUMMARY_API.format(title=name),
                headers={"User-Agent": "PlantyJ-Metadata-Bot/1.0 (mailto:your@email.com)"}, 
                timeout=5
            )
            
            # If rate limited, wait and try again instead of failing immediately
            if resp.status_code == 429:
                wait_time = 2 ** attempt  # 1s, 2s, 4s backoff
                print(f"  WARN: 429 Rate limited for '{name}'. Retrying in {wait_time}s...", file=sys.stderr)
                time.sleep(wait_time)
                continue
                
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "description": data.get("extract"),
                    "url": data.get("content_urls", {}).get("desktop", {}).get("page")
                }
                
            # If we get a 404 or other non-rate-limit error, just return None
            return None
            
        except requests.exceptions.Timeout:
            print(f"  WARN: Timeout for '{name}'. Retrying...", file=sys.stderr)
            time.sleep(1)
        except Exception as e:
            print(f"  WARN: Taxon lookup failed for '{name}': {e}", file=sys.stderr)
            return None
            
    # If we exhaust all retries, THEN we trigger the global bail-out mechanism
    health.mark_throttled("Wikipedia API repeatedly refused connections")
    return None

def build_taxa_registry(species_entries: list[dict]) -> int:
    health = IntegrationHealth("TaxaRegistry")
    taxa_registry = {}
    
    # 1. Gracefully handle empty files to prevent the "malformed" warning
    if TAXA_PATH.exists() and TAXA_PATH.stat().st_size > 0:
        try:
            taxa_registry = json.loads(TAXA_PATH.read_text())
        except json.JSONDecodeError:
            print("  WARN: taxa.json contains invalid JSON, starting fresh.", file=sys.stderr)

    # 2. Harvest all unique taxa names
    ranks_to_collect = ["kingdom", "phylum", "class", "order", "family", "genus"]
    unique_taxa = set()
    
    for entry in species_entries:
        taxonomy = entry.get("taxonomy")
        if taxonomy:
            for rank in ranks_to_collect:
                taxon_name = taxonomy.get(rank)
                if isinstance(taxon_name, str) and taxon_name.strip():
                    unique_taxa.add(taxon_name.strip())

    # 3. Fetch data for missing taxa
    added_count = 0
    for taxon in sorted(unique_taxa):
        if health.should_bail:
            break
            
        if taxon in taxa_registry:
            continue 
            
        print(f"  Taxa lookup: {taxon}")
        summary = fetch_taxon_summary(taxon, health)
        
        taxa_registry[taxon] = summary if summary else {"description": None, "url": None}
        added_count += 1
        
        # 4. Increased polite delay to 0.5 seconds
        time.sleep(0.5)

    # 5. Write the updated registry
    if added_count > 0:
        TAXA_PATH.parent.mkdir(parents=True, exist_ok=True)
        TAXA_PATH.write_text(json.dumps(taxa_registry, indent=2) + "\n")
        
    return added_count