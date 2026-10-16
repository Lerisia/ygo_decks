import { type ReactNode, type SelectHTMLAttributes, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import SearchForm from "@/components/SearchForm";
import { getBanTable } from "@/api/banlistApi";
import { type BanKind, type BanlistIndex, BAN_KINDS, banlistOptions, dayLabel, fullDay, isCode, parseBanlistKey } from "@/lib/banlists";

const FIELD = "h-7 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-black dark:text-white";
// the second box is as wide for a day as for a code, so changing the 금제's kind moves nothing on the line
const SECOND = "w-[7rem] border-l-0 rounded-l-none rounded-r-lg";
const CARET = "pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400";

/** A choice drawn small: its label in the box, the system's own select laid over it unseen. A phone keeps every
 *  select at 16px (index.css, so iOS does not zoom), which would make the line too wide for the warnings. */
function PickBox({ label, title, className, children, ...select }: {
  label: string; title?: string; className: string; children: ReactNode;
} & Pick<SelectHTMLAttributes<HTMLSelectElement>, "aria-label" | "value" | "onChange">) {
  return (
    <span title={title} className={`relative flex items-center pl-2 pr-5 text-xs font-semibold tabular-nums focus-within:ring-2 focus-within:ring-blue-500 focus-within:z-10 ${FIELD} ${className}`}>
      <span aria-hidden className="min-w-0 truncate">{label}</span>
      <ChevronDown className={CARET} aria-hidden />
      <select {...select} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer bg-white dark:bg-gray-800 text-black dark:text-white text-xs">
        {children}
      </select>
    </span>
  );
}

/** The 금제 a deck is checked by, on the line under its name (참혈 2026-10-16): [마듀 / OCG / TCG / 커스텀] | [the
 *  list]. A game's 최신 (followed to the next list), or one of its lists by day, newest first; a kind changed goes to
 *  its 최신. 커스텀 takes a code, asked for on Enter; the deck keeps being checked by the list before until a code is
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
    options.push({ value, label: dayLabel(choice.kind, choice.day, index?.lists[choice.kind]), title: fullDay(choice.day) });
  }
  const picked = options.find((o) => o.value === value) ?? options[0];
  const message = asked === "missing" ? "없는 금제 코드예요" : asked === "failed" ? "코드를 확인하지 못했어요" : "";

  return (
    <div className="relative shrink-0 flex items-stretch">
      <PickBox
        aria-label="금제 종류"
        title="금제 종류"
        label={BAN_KINDS.find((k) => k.kind === kind)?.label ?? ""}
        value={kind}
        onChange={(e) => pickKind(e.target.value as BanKind)}
        className="w-16 rounded-l-lg rounded-r-none"
      >
        {BAN_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </PickBox>
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
        <PickBox aria-label="금제 날짜" title={picked?.title} label={picked?.label ?? ""} value={picked?.value} onChange={(e) => onChange(e.target.value)} className={SECOND}>
          {options.map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
        </PickBox>
      )}
      {/* under the code box, over the gap below the line, so the line itself never moves */}
      {kind === "custom" && message && (
        <span
          role="alert"
          className="absolute left-16 top-full mt-1 z-20 whitespace-nowrap rounded-md border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-800 px-1.5 text-[11px] leading-[18px] font-semibold text-red-600 dark:text-red-400 shadow-sm"
        >
          {message}
        </span>
      )}
    </div>
  );
}
