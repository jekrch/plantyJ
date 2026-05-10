import { useEffect, useMemo, useState } from "react";
import type { Relationship, RelationshipType, RelationshipsFile } from "../types";

export interface RelationshipsData {
  types: RelationshipType[];
  typeById: Map<string, RelationshipType>;
  relationships: Relationship[];
  neighbors: Map<string, Relationship[]>;
  loaded: boolean;
}

export function useRelationships(): RelationshipsData {
  const [types, setTypes] = useState<RelationshipType[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}data/relationships.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`relationships.json: ${res.status}`);
        return res.json() as Promise<RelationshipsFile>;
      })
      .then((data) => {
        setTypes(data.types ?? []);
        setRelationships(data.relationships ?? []);
      })
      .catch(() => {
        setTypes([]);
        setRelationships([]);
      })
      .finally(() => setLoaded(true));
  }, []);

  const typeById = useMemo(() => {
    const m = new Map<string, RelationshipType>();
    for (const t of types) m.set(t.id, t);
    return m;
  }, [types]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Relationship[]>();
    for (const r of relationships) {
      if (!m.has(r.from)) m.set(r.from, []);
      m.get(r.from)!.push(r);
      if (r.from !== r.to) {
        if (!m.has(r.to)) m.set(r.to, []);
        m.get(r.to)!.push(r);
      }
    }
    return m;
  }, [relationships]);

  return { types, typeById, relationships, neighbors, loaded };
}

// Effective direction for an instance, after applying the optional override
// against the type's default. Returns "fwd" (from→to), "bwd" (to→from), or "u" (undirected).
export function effectiveDirection(
  rel: Relationship,
  type: RelationshipType | undefined
): "fwd" | "bwd" | "u" {
  if (rel.direction === "b") return "bwd";
  if (rel.direction === "u") return "u";
  if (rel.direction === "f") return "fwd";
  return type?.directional ? "fwd" : "u";
}
