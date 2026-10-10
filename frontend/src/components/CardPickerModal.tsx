import { useEffect, useRef, useState } from "react";
import PickerModal, { PickerPanel, type PickerItem, type PickerStatus } from "./PickerModal";
import { EMPTY_FILTERS, listCards } from "@/api/cardDexApi";

/** Pick one card of the card book by its Korean, Japanese or English name, shown as the whole card — the deck
 *  picker's twin. The server ranks the names (exact → prefix → substring) as the query is typed. */
export default function CardPickerModal({
  open, onClose, onPick, inline = false,
}: { open: boolean; onClose: () => void; onPick: (cardId: number) => void; inline?: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [status, setStatus] = useState<PickerStatus>("idle");
  const request = useRef(0);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    const id = ++request.current;
    if (!q) {
      setItems([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const t = setTimeout(() => {
      listCards({ ...EMPTY_FILTERS, q }, 1)
        .then((r) => {
          if (id !== request.current) return;
          setItems(r.results.map((c) => ({ key: c.id, name: c.name, image: c.face_thumb_url || c.thumb_url || c.image_url })));
          setStatus(r.results.length ? "ready" : "empty");
        })
        .catch(() => id === request.current && setStatus("empty"));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const panel = {
    onClose,
    title: "🃏 카드 찾기",
    placeholder: "카드 이름 (한국어·일본어·영어)",
    query,
    onQueryChange: setQuery,
    items,
    status,
    idleText: "카드 이름을 입력하세요.",
    emptyText: "그런 이름의 카드가 없습니다.",
    onPick: (it: PickerItem) => onPick(Number(it.key)),
    viewKey: "card",
    imageFit: "contain" as const,
    imageAspect: "aspect-[704/1024]",
  };
  // Inline: drawn where the caller puts it (the home page on desktop opens the search out in place).
  if (inline) return open ? <PickerPanel {...panel} variant="inline" /> : null;
  return <PickerModal open={open} {...panel} />;
}
