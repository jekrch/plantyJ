#!/usr/bin/env python3
"""Build public/data/rollup.min.json from the source data JSONs."""

import json
import os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")


def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)


def load_optional(name, default):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def day(ts):
    """Truncate an ISO-8601 timestamp to its calendar date (YYYY-MM-DD).

    ISO dates sort lexicographically, so min/max over these still works.
    """
    if not ts:
        return None
    return ts[:10]


def compact_pic(pic):
    """Build a space-minimal pic record, omitting null/empty fields."""
    rec = {"seq": pic["seq"]}
    if pic.get("zoneCode"):
        rec["zone"] = pic["zoneCode"]
    if pic.get("tags"):
        rec["tags"] = pic["tags"]
    if pic.get("description"):
        rec["description"] = pic["description"]
    at = day(pic.get("addedAt"))
    if at:
        rec["at"] = at
    return rec


def main():
    plants_raw = load("plants.json")["plants"]
    pics_raw = load("pics.json")["pics"]
    zones_raw = load("zones.json")["zones"]
    zone_pics_raw = load("zone_pics.json")["zonePics"]
    annotations_raw = load("annotations.json")["annotations"]
    relationships_raw = load_optional(
        "relationships.json", {"types": [], "relationships": []}
    )

    zones_with_pics = {zp["zoneCode"] for zp in zone_pics_raw}
    zones = sorted(
        [
            {
                "code": z["code"],
                **({"name": z["name"]} if z.get("name") else {}),
                **({"hasZonePic": True} if z["code"] in zones_with_pics else {}),
                **({"description": z["description"]} if z.get("description") else {}),
            }
            for z in zones_raw
        ],
        key=lambda z: z["code"],
    )

    plant_codes = {p["shortCode"] for p in plants_raw}

    ann_by_plant = {}
    for a in annotations_raw:
        sc = a["shortCode"]
        zc = a.get("zoneCode")
        if sc not in ann_by_plant:
            ann_by_plant[sc] = {"plant": None, "byZone": {}}
        if zc is None:
            ann_by_plant[sc]["plant"] = a
        else:
            ann_by_plant[sc]["byZone"][zc] = a

    pics_by_plant = {}
    orphan_pics = []
    for pic in pics_raw:
        sc = pic["shortCode"]
        if sc not in plant_codes:
            orphan_pics.append({"shortCode": sc, **compact_pic(pic)})
        else:
            pics_by_plant.setdefault(sc, []).append(pic)

    plants = []
    for p in sorted(plants_raw, key=lambda x: x["shortCode"]):
        sc = p["shortCode"]
        raw_pics = sorted(
            pics_by_plant.get(sc, []),
            key=lambda x: x.get("addedAt", ""),
            reverse=True,
        )

        ann = ann_by_plant.get(sc, {})
        plant_ann = ann.get("plant") or {}
        by_zone_raw = ann.get("byZone", {})

        by_zone = {}
        for zc, za in sorted(by_zone_raw.items()):
            entry = {}
            if za.get("tags"):
                entry["tags"] = za["tags"]
            if za.get("description"):
                entry["description"] = za["description"]
            by_zone[zc] = entry

        compact_pics = [compact_pic(pic) for pic in raw_pics]

        zones_seen = sorted({pic["zone"] for pic in compact_pics if pic.get("zone")})
        dates = [pic["at"] for pic in compact_pics if pic.get("at")]
        last_seen = max(dates) if dates else None
        first_seen = min(dates) if dates else None

        is_animal = any(pic.get("kind") == "animal" for pic in raw_pics)

        record = {"shortCode": sc}
        if p.get("fullName"):
            record["fullName"] = p["fullName"]
        if p.get("commonName"):
            record["commonName"] = p["commonName"]
        if p.get("variety"):
            record["variety"] = p["variety"]
        if is_animal:
            record["kind"] = "animal"
        if plant_ann.get("tags"):
            record["tags"] = plant_ann["tags"]
        if plant_ann.get("description"):
            record["description"] = plant_ann["description"]
        if by_zone:
            record["byZone"] = by_zone
        record["pics"] = compact_pics
        record["picCount"] = len(compact_pics)
        record["zonesSeen"] = zones_seen
        if last_seen:
            record["lastSeenAt"] = last_seen
        if first_seen:
            record["firstSeenAt"] = first_seen

        plants.append(record)

    rel_types = []
    for t in relationships_raw.get("types", []):
        t_rec = {"id": t["id"], "name": t.get("name", t["id"])}
        if t.get("description"):
            t_rec["description"] = t["description"]
        if t.get("directional"):
            t_rec["directional"] = True
        rel_types.append(t_rec)
    rel_edges = [
        [
            r["id"],
            r["type"],
            r["from"],
            r["to"],
            r.get("direction"),
        ]
        for r in relationships_raw.get("relationships", [])
    ]

    rollup = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "zones": zones,
        "plants": plants,
        "orphanPics": orphan_pics,
        "relationships": {"types": rel_types, "edges": rel_edges},
    }

    out_min = os.path.join(DATA_DIR, "rollup.min.json")
    with open(out_min, "w") as f:
        json.dump(rollup, f, separators=(",", ":"))

    print(f"Wrote {out_min} ({os.path.getsize(out_min)} bytes, {len(plants)} plants, {len(zones)} zones)")


if __name__ == "__main__":
    main()
