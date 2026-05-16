import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { RawNode } from "./types";
import { RANK_LABEL } from "./types";
import { organismTitle } from "../../utils/display";

export interface SearchItem {
  node: HierarchyPointNode<RawNode>;
  label: string;
  sublabel: string;
  haystack: string;
}

export function useTreeSearch(
  nodes: HierarchyPointNode<RawNode>[],
  onSelect: (node: HierarchyPointNode<RawNode>) => void,
  onCloseDetail?: () => void
) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHi, setSearchHi] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Intercept Ctrl+F / Cmd+F to open the custom search.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onCloseDetail?.();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [searchOpen]);

  const searchIndex = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    for (const n of nodes) {
      if (n.depth === 0) continue;
      if (n.data.organism) {
        const p = n.data.organism;
        const label = organismTitle(p);
        const sublabel = p.fullName ?? RANK_LABEL[n.data.rank];
        const fields = [p.commonName, p.fullName, p.variety, p.shortCode, n.data.name].filter(
          Boolean
        ) as string[];
        items.push({ node: n, label, sublabel, haystack: fields.join(" \n ").toLowerCase() });
      } else {
        items.push({
          node: n,
          label: n.data.name,
          sublabel: RANK_LABEL[n.data.rank],
          haystack: n.data.name.toLowerCase(),
        });
      }
    }
    return items;
  }, [nodes]);

  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as SearchItem[];
    const hits: { item: SearchItem; score: number }[] = [];
    for (const item of searchIndex) {
      const idx = item.haystack.indexOf(q);
      if (idx === -1) continue;
      hits.push({ item, score: (item.label.toLowerCase().startsWith(q) ? 0 : 1000) + idx });
    }
    hits.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
    return hits.slice(0, 12).map((h) => h.item);
  }, [searchQuery, searchIndex]);

  useEffect(() => { setSearchHi(0); }, [matches]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchHi(0);
  }, []);

  const selectSearchItem = useCallback(
    (item: SearchItem) => {
      closeSearch();
      onSelect(item.node);
    },
    [closeSearch, onSelect]
  );

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearchHi((i) => Math.min(matches.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSearchHi((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = matches[searchHi] ?? matches[0];
        if (pick) selectSearchItem(pick);
      }
    },
    [matches, searchHi, closeSearch, selectSearchItem]
  );

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchHi,
    setSearchHi,
    matches,
    searchInputRef,
    closeSearch,
    selectSearchItem,
    onSearchKeyDown,
  };
}
