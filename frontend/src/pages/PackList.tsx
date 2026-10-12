import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SearchForm from "@/components/SearchForm";
import { Input } from "@/components/ui/input";
import PackFront from "@/components/packs/PackFront";
import { type PackKind, type PackSummary, getPacks } from "@/api/packApi";
import { makeMatcher, nameKeys } from "@/utils/hangul";
import { isAuthenticated } from "@/api/accountApi";

const KINDS: { key: "all" | PackKind; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "secret", label: "시크릿 팩" },
  { key: "selection", label: "셀렉션 팩" },
  { key: "normal", label: "마스터 팩" },
];

/** 팩 개봉 시뮬레이터 (엘리스 2026-10-12): every master, selection and secret pack Master Duel has had, newest first
 *  (the master pack ahead), by kind or by name. */
export default function PackList() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<"all" | PackKind>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    getPacks().then(setPacks).catch(() => setError(true));
  }, []);

  const shown = useMemo(() => {
    if (!packs) return [];
    const match = makeMatcher(query);
    const en = query.trim().toLowerCase();
    return packs
      .filter((p) => kind === "all" || p.kind === kind)
      .filter((p) => !en || match(nameKeys(p.name)) || p.name_en.toLowerCase().includes(en))
      .sort((a, b) => Number(b.master) - Number(a.master));
  }, [packs, kind, query]);

  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-5xl mx-auto">
      <button
        onClick={() => navigate("/playground")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← 놀이터
      </button>
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl md:text-4xl font-bold">팩 개봉 시뮬레이터</h1>
        {isAuthenticated() && <Link to="/packs/collection" className="shrink-0 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">카드 모음 →</Link>}
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">
        마스터 듀얼의 팩을 게임과 같은 제공 확률로 열어 봅니다. 뽑은 카드는 카드 모음에 쌓입니다.
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <div role="tablist" aria-label="팩 종류" className="grid grid-cols-4 rounded-lg bg-gray-200 dark:bg-gray-700 p-0.5 text-sm font-semibold sm:w-[26rem] shrink-0">
          {KINDS.map((k) => (
            <button
              key={k.key}
              role="tab"
              aria-selected={kind === k.key}
              onClick={() => setKind(k.key)}
              className={`h-9 rounded-md whitespace-nowrap transition ${kind === k.key ? "bg-white dark:bg-gray-900 shadow text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-300"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <SearchForm>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="팩 이름으로 찾기" aria-label="팩 이름으로 찾기" enterKeyHint="search" className="flex-1 h-10" />
        </SearchForm>
      </div>

      <p className="mt-3 h-5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {packs ? `${shown.length.toLocaleString()}개` : ""}
      </p>
      {error ? (
        <p className="py-16 text-center text-gray-500">팩 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
      ) : (
        <ul className="mt-1 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-4">
          {packs
            ? shown.map((p) => (
                <li key={p.id}>
                  <Link to={`/packs/${p.id}`} className="group block">
                    <PackFront name={p.name} src={p.image} className="w-full rounded-md shadow group-hover:shadow-lg transition" />
                    <span className="mt-1.5 block text-xs sm:text-sm font-semibold leading-snug break-keep line-clamp-2 min-h-[2.5em]">{p.name}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{p.released ?? ""}</span>
                  </Link>
                </li>
              ))
            : Array.from({ length: 12 }, (_, i) => (
                <li key={i} aria-hidden="true">
                  <div className="w-full aspect-[250/512] rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="mt-1.5 h-[2.5em] rounded bg-gray-200 dark:bg-gray-700 animate-pulse text-xs sm:text-sm" />
                  <div className="mt-0.5 h-[14px] w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}
