import { useEffect, useMemo, useState } from "react";
import PickerModal, { PickerPanel, type PickerItem } from "./PickerModal";
import { matchesDeckQuery } from "@/utils/hangul";

type DeckRow = { id: number; name: string; aliases?: string[]; strength?: string; cover_image?: string | null; cover_image_phone?: string | null };

// The deck list is the same for everyone and rarely changes: fetched once per visit.
let cached: DeckRow[] | null = null;

/** Pick one deck from the whole deck book (name, alias or 초성), as pictures or a list.
 *  Only real decks can be picked, so nobody lands on a search for a deck that does not exist. */
export default function DeckPickerModal({
  open, onClose, onPick, inline = false,
}: { open: boolean; onClose: () => void; onPick: (deckId: number) => void; inline?: boolean }) {
  const [decks, setDecks] = useState<DeckRow[] | null>(cached);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (cached) return;
    fetch("/api/deck/")
      .then((r) => r.json())
      .then((d) => {
        cached = [...(d.decks || [])].sort((a: DeckRow, b: DeckRow) => a.name.localeCompare(b.name, "ko"));
        setDecks(cached);
      })
      .catch(() => setDecks([]));
  }, [open]);

  const items: PickerItem[] = useMemo(
    () =>
      (decks ?? [])
        .filter((d) => matchesDeckQuery(query, d.name, d.aliases ?? []))
        // is_upcoming marks a 신규 업데이트 덱 that is already out, so it shows its deck power like any other (특이점 2026-10-07).
        .map((d) => ({ key: d.id, name: d.name, image: d.cover_image_phone || d.cover_image, sub: d.strength })),
    [decks, query],
  );

  const panel = {
    onClose,
    title: "📚 덱 찾기",
    placeholder: "덱 이름·별명·초성",
    query,
    onQueryChange: setQuery,
    items,
    status: (decks === null ? "loading" : items.length ? "ready" : "empty") as "loading" | "ready" | "empty",
    emptyText: "그런 이름의 덱이 없습니다.",
    onPick: (it: PickerItem) => onPick(Number(it.key)),
    viewKey: "deck",
    imageFit: "cover" as const,
  };
  // Inline: drawn where the caller puts it (the home page on desktop opens the search out in place).
  if (inline) return open ? <PickerPanel {...panel} variant="inline" /> : null;
  return <PickerModal open={open} {...panel} />;
}
