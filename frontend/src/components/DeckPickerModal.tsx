import { useEffect, useMemo, useState } from "react";
import PickerModal, { type PickerItem } from "./PickerModal";
import { matchesDeckQuery } from "@/utils/hangul";

type DeckRow = { id: number; name: string; aliases?: string[]; strength?: string; is_upcoming?: boolean; cover_image?: string | null };

// The deck list is the same for everyone and rarely changes: fetched once per visit.
let cached: DeckRow[] | null = null;

/** Pick one deck from the whole deck book (name, alias or 초성), as pictures or a list.
 *  Only real decks can be picked, so nobody lands on a search for a deck that does not exist. */
export default function DeckPickerModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (deckId: number) => void }) {
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
        .map((d) => ({ key: d.id, name: d.name, image: d.cover_image, sub: d.is_upcoming ? "출시 예정" : d.strength })),
    [decks, query],
  );

  return (
    <PickerModal
      open={open}
      onClose={onClose}
      title="📚 덱 찾기"
      placeholder="덱 이름·별명·초성"
      query={query}
      onQueryChange={setQuery}
      items={items}
      status={decks === null ? "loading" : items.length ? "ready" : "empty"}
      emptyText="그런 이름의 덱이 없습니다."
      onPick={(it) => onPick(Number(it.key))}
      viewKey="deck"
      imageFit="cover"
    />
  );
}
