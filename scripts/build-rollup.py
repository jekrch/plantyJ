#!/usr/bin/env python3
"""Build public/data/rollup.min.json from the source data JSONs."""

import json
import os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")


def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)


def main():
    plants_raw = load("plants.json")["plants"]
    pics_raw = load("pics.json")["pics"]
    zones_raw = load("zones.json")["zones"]
    zone_pics_raw = load("zone_pics.json")["zonePics"]
    annotations_raw = load("annotations.json")["annotations"]

    zones_with_pics = {zp["zoneCode"] for zp in zone_pics_raw}
    zones = sorted(
        [
            {
                "code": z["code"],
                "name": z.get("name"),
                "hasZonePic": z["code"] in zones_with_pics,
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
            orphan_pics.append(
                {
                    "seq": pic["seq"],
                    "shortCode": sc,
                    "zone": pic.get("zoneCode"),
                    "tags": pic.get("tags", []),
                    "description": pic.get("description"),
                    "by": pic.get("postedBy"),
                    "at": pic.get("addedAt"),
                }
            )
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
            else:
                entry["tags"] = []
            entry["description"] = za.get("description")
            by_zone[zc] = entry

        compact_pics = [
            {
                "seq": pic["seq"],
                "zone": pic.get("zoneCode"),
                "tags": pic.get("tags", []),
                "description": pic.get("description"),
                "by": pic.get("postedBy"),
                "at": pic.get("addedAt"),
            }
            for pic in raw_pics
        ]

        zones_seen = sorted({pic["zone"] for pic in compact_pics if pic["zone"]})
        dates = [pic["at"] for pic in compact_pics if pic["at"]]
        last_seen = max(dates) if dates else None
        first_seen = min(dates) if dates else None

        is_animal = any(pic.get("kind") == "animal" for pic in raw_pics)

        record = {
            "shortCode": sc,
            "fullName": p.get("fullName"),
            "commonName": p.get("commonName"),
        }
        if p.get("variety"):
            record["variety"] = p["variety"]
        if is_animal:
            record["kind"] = "animal"
        record["tags"] = plant_ann.get("tags", [])
        record["description"] = plant_ann.get("description")
        record["byZone"] = by_zone
        record["pics"] = compact_pics
        record["picCount"] = len(compact_pics)
        record["zonesSeen"] = zones_seen
        record["lastSeenAt"] = last_seen
        record["firstSeenAt"] = first_seen

        plants.append(record)

    rollup = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "zones": zones,
        "plants": plants,
        "orphanPics": orphan_pics,
    }

    out_min = os.path.join(DATA_DIR, "rollup.min.json")
    with open(out_min, "w") as f:
        json.dump(rollup, f, separators=(",", ":"))

    print(f"Wrote {out_min} ({os.path.getsize(out_min)} bytes, {len(plants)} plants, {len(zones)} zones)")


if __name__ == "__main__":
    main()
