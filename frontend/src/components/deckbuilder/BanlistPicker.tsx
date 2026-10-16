import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";
import SearchForm from "@/components/SearchForm";
import { getBanTable } from "@/api/banlistApi";
import { type BanKind, type BanlistIndex, BAN_KINDS, banlistOptions, dayLabel, fullDay, isCode, parseBanlistKey } from "@/lib/banlists";

const FIELD = "h-7 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-black dark:text-white";
const BOX = "h-7 pl-2 text-xs tabular-nums";
// the kind as wide for 마스터 듀얼 as for OCG, the second box as wide for a day as for a code, so changing the 금제 moves
// nothing on the line
const FIRST = "w-[4.75rem] pr-2 rounded-l-lg rounded-r-none";
const SECOND = "w-[5.5rem] border-l-0 rounded-l-none rounded-r-lg";
const KINDS = BAN_KINDS.map((k) => ({ value: k.kind, label: k.label }));

/** The 금제 a deck is checked by, on the left of the line under its name (참혈 2026-10-16): [마스터 듀얼 / OCG / TCG /
 *  커스텀] [the list], both the site's own drop-down, the kind's with no ▾. A game's 최신 (followed to the next list,
 *  「최신」 closed and its day in the open list), or one of its lists by day, newest first; a kind changed goes to its
 *  최신. 커스텀 takes a code, asked for on Enter; the deck keeps being checked by the list before until a code is
 *  found, a code not found said under the box without moving the line. */
export default function BanlistPicker({ value, index, onChange }: {
  /** The deck's key (lib/banlists). */
  value: string;
  index: BanlistIndex | null;
  onChange: (key: string) => void;
}) {
  const choice = parseBanlistKey(value);
  const [kind, setKind] = useState<BanKind>(choice?.kind ?? "md");
  const [code, setCode] = useState(choice?.kind === "custom" ? choice.code : "");
  const [asked, setAsked] = useState<"" | "checking" | "missing" | "failed">("");
  useEffect(() => {
    const c = parseBanlistKey(value);
    if (!c) return;
    setKind(c.kind);
    if (c.kind === "custom") setCode(c.code);
  }, [value]);
  // each game's newest ready, so a kind picked is judged at once
  useEffect(() => {
    for (const k of ["md", "ocg", "tcg"]) getBanTable(k).catch(() => {});
  }, []);

  const pickKind = (k: BanKind) => {
    setKind(k);
    setAsked("");
    if (k !== "custom") onChange(k);
  };
  const lookUp = () => {
    const c = code.trim();
    if (!isCode(c)) {
      setAsked("missing");
      return;
    }
    setAsked("checking");
    getBanTable(`custom:${c}`).then(
      () => {
        setAsked("");
        onChange(`custom:${c}`);
      },
      (e) => setAsked(e.status === 404 ? "missing" : "failed"),
    );
  };

  const options = kind === "custom" ? [] : banlistOptions(kind, index);
  // a list the index doesn't hold (not come yet, or gone since) still shows as the deck's
  if (choice && choice.kind === kind && choice.kind !== "custom" && choice.day && !options.some((o) => o.value === value)) {
    const label = dayLabel(choice.kind, choice.day, index?.lists[choice.kind]);
    options.push({ value, label, shown: label, title: fullDay(choice.day) });
  }
  const picked = options.find((o) => o.value === value) ?? options[0];
  const message = asked === "missing" ? "없는 금제 코드예요" : asked === "failed" ? "코드를 확인하지 못했어요" : "";

  return (
    <div className="relative shrink-0 flex items-stretch">
      <Dropdown label="금제 종류" title="금제 종류" value={kind} options={KINDS} onChange={pickKind} caret={false} className={`${BOX} ${FIRST}`} listClassName="text-xs" />
      {kind === "custom" ? (
        <SearchForm onSearch={lookUp}>
          <input
            aria-label="금제 코드"
            aria-invalid={!!message}
            placeholder="금제 코드"
            value={code}
            maxLength={32}
            onChange={(e) => {
              setCode(e.target.value);
              setAsked("");
            }}
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={`${FIELD} ${SECOND} px-2 text-base md:text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 placeholder:text-gray-400 dark:placeholder:text-gray-500 ${message ? "border-red-500 dark:border-red-400" : ""}`}
          />
        </SearchForm>
      ) : (
        <Dropdown
          label="금제 날짜"
          title={picked?.title}
          value={picked?.value ?? kind}
          options={options}
          onChange={onChange}
          className={`${BOX} pr-1.5 ${SECOND}`}
          listClassName="text-xs"
        />
      )}
      {/* under the code box, over the gap below the line, so the line itself never moves */}
      {kind === "custom" && message && (
        <span
          role="alert"
          className="absolute left-[4.75rem] top-full mt-1 z-20 whitespace-nowrap rounded-md border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-800 px-1.5 text-[11px] leading-[18px] font-semibold text-red-600 dark:text-red-400 shadow-sm"
        >
          {message}
        </span>
      )}
    </div>
  );
}
