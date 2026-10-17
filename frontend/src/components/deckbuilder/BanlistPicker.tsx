import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { DROPDOWN_BOX } from "@/components/Dropdown";
import SearchForm from "@/components/SearchForm";
import { getBanTable } from "@/api/banlistApi";
import { dropPlace } from "@/lib/dropdown";
import {
  type BanFormat, type BanKind, type BanlistIndex, BAN_KINDS, NO_BANLIST, NO_BANLIST_LABEL, banlistName, banlistTitle, banlistYears, followsTitle,
  fullDay, isCode, latestDay, parseBanlistKey, pickerKind, recentCodes, rememberCode,
} from "@/lib/banlists";

// the panel's size, the same for every kind so moving between them moves nothing; narrower on a phone
const PANEL_WIDTH = 448;
const PANEL_HEIGHT = 300;
// a group's name over its items, its text where theirs starts
const GROUP = "m-0 mb-1 px-2 text-[11px] leading-4 font-semibold text-gray-500 dark:text-gray-400";
const ITEM = "shrink-0 h-7 px-2 inline-flex items-center rounded-md border-0 text-xs font-semibold tabular-nums whitespace-nowrap transition-colors";
const ITEM_OFF = "bg-transparent text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700";
const ITEM_ON = "bg-blue-600 text-white hover:bg-blue-600";

function Item({ on, title, onClick, children, className = "" }: { on: boolean; title?: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick} className={`${ITEM} ${on ? ITEM_ON : ITEM_OFF} ${className}`}>
      {children}
    </button>
  );
}

/** A game's lists (참혈 2026-10-17): 최신 on top — its newest list's whole day, followed to the next —, under it the
 *  lists by year, the newest year on the left, each year's newest on top; a list announced for a later day says 예정. */
function GameLists({ format, value, index, onPick }: { format: BanFormat; value: string; index: BanlistIndex | null; onPick: (key: string) => void }) {
  const latest = index && latestDay(index, format);
  const years = banlistYears(format, index);
  return (
    <>
      <section className="shrink-0">
        <p className={GROUP}>최신</p>
        <Item on={value === format} title={followsTitle(index, format)} onClick={() => onPick(format)}>
          {latest ? fullDay(latest) : "최신"}
        </Item>
      </section>
      <div className="min-h-0 flex-1 -mx-1 px-1 overflow-auto overscroll-contain">
        {years.length ? (
          <div className="flex gap-3 w-max">
            {years.map(({ year, days }) => (
              <div key={year} className="flex flex-col items-start">
                <p className={`${GROUP} sticky top-0 z-[1] w-full mb-0 h-6 leading-6 bg-white dark:bg-gray-800 tabular-nums`}>{year}년</p>
                {days.map((d) => (
                  <Item key={d.key} on={value === d.key} title={d.later ? `${fullDay(d.day)} 적용 예정` : fullDay(d.day)} onClick={() => onPick(d.key)}>
                    {d.label}
                    {d.later && <span className={`ml-1 text-[10px] font-normal ${value === d.key ? "" : "text-gray-400 dark:text-gray-500"}`}>예정</span>}
                  </Item>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 px-2 py-2 text-gray-500 dark:text-gray-400">{index ? "아직 금제가 없습니다." : "불러오는 중…"}</p>
        )}
      </div>
    </>
  );
}

/** 커스텀 (참혈 2026-10-17): 커스텀 코드 — 직접 입력, a code asked for on Enter —, 프리셋 (무금제), and the codes this
 *  browser used last. */
function CustomLists({ value, onPick }: { value: string; onPick: (key: string) => void }) {
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [asked, setAsked] = useState<"" | "checking" | "missing" | "failed">("");
  const choice = parseBanlistKey(value);
  const current = choice?.kind === "custom" ? choice.code : null;
  // the deck's own code shown even when this browser hasn't used it
  const recent = [...(current ? [current] : []), ...recentCodes().filter((c) => c !== current)];
  const lookUp = (c: string) => {
    if (!isCode(c)) {
      setAsked("missing");
      return;
    }
    setAsked("checking");
    getBanTable(`custom:${c}`).then(
      () => {
        setAsked("");
        rememberCode(c);
        onPick(`custom:${c}`);
      },
      (e) => setAsked(e.status === 404 ? "missing" : "failed"),
    );
  };
  const message = asked === "missing" ? "없는 금제 코드예요" : asked === "failed" ? "코드를 확인하지 못했어요" : "";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain flex flex-col gap-3">
      <section>
        <p className={GROUP}>커스텀 코드</p>
        {typing ? (
          <SearchForm onSearch={() => lookUp(code.trim())}>
            <div className="flex items-center gap-1">
              <input
                autoFocus
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
                className={`min-w-0 w-36 h-7 px-2 rounded-md border bg-white dark:bg-gray-900 text-base md:text-xs text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500 ${
                  message ? "border-red-500 dark:border-red-400" : "border-gray-300 dark:border-gray-600"
                }`}
              />
              <button type="submit" disabled={!code.trim() || asked === "checking"} className={`${ITEM} bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`}>
                적용
              </button>
            </div>
          </SearchForm>
        ) : (
          <button type="button" onClick={() => setTyping(true)} className={`${ITEM} border border-dashed border-gray-300 dark:border-gray-600 ${ITEM_OFF}`}>
            직접 입력
          </button>
        )}
        <p role="alert" className="m-0 mt-1 px-2 h-4 text-[11px] leading-4 font-semibold text-red-600 dark:text-red-400">{message}</p>
      </section>
      <section>
        <p className={GROUP}>프리셋</p>
        <Item on={value === NO_BANLIST} title={banlistTitle(NO_BANLIST, null)} onClick={() => onPick(NO_BANLIST)}>
          {NO_BANLIST_LABEL}
        </Item>
      </section>
      <section>
        <p className={GROUP}>최근 사용</p>
        {recent.length ? (
          <div className="flex flex-wrap gap-1">
            {recent.map((c) => (
              <Item key={c} on={c === current} onClick={() => lookUp(c)}>{c}</Item>
            ))}
          </div>
        ) : (
          <p className="m-0 px-2 text-gray-400 dark:text-gray-500">최근 사용한 코드가 없습니다.</p>
        )}
      </section>
    </div>
  );
}

/** The 금제 a deck is checked by, on the left of the line under its name: one button naming it as the deck's page does
 *  (마스터 듀얼 • 최신), opening a panel (참혈 2026-10-17) — the kinds on the left (마스터 듀얼 / OCG / TCG / 커스텀), the
 *  kind's lists on the right, an item pressed taking effect and closing it. A kind pressed only shows its lists. The
 *  panel opens under the button (above when below is short), fixed in size; Esc or a press outside closes it. */
export default function BanlistPicker({ value, index, onChange }: {
  /** The deck's key (lib/banlists). */
  value: string;
  index: BanlistIndex | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BanKind>(() => pickerKind(parseBanlistKey(value)));
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // each game's newest ready, so a list picked is judged at once
  useEffect(() => {
    for (const k of ["md", "ocg", "tcg"]) getBanTable(k).catch(() => {});
  }, []);

  const close = (refocus = false) => {
    setOpen(false);
    setPlace(null);
    if (refocus) button.current?.focus();
  };
  const toggle = () => {
    if (open) return close();
    setKind(pickerKind(parseBanlistKey(value)));
    setOpen(true);
  };
  const pick = (key: string) => {
    close(true);
    if (key !== value) onChange(key);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const b = button.current?.getBoundingClientRect();
      if (!b) return;
      const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const width = Math.min(PANEL_WIDTH, view.width - 16);
      const p = dropPlace({ anchor: b, list: { width, height: PANEL_HEIGHT }, view, max: PANEL_HEIGHT });
      setPlace({ top: p.top, bottom: p.bottom, left: p.left, width, height: p.maxHeight });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open]);
  // opened: the item in effect in sight and focused (the code box takes the focus itself)
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const on = panel.current?.querySelector<HTMLElement>("[aria-pressed='true']") ?? panel.current?.querySelector<HTMLElement>("[aria-selected='true']");
    on?.scrollIntoView({ block: "nearest", inline: "nearest" });
    on?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  // Esc closes here, not at the page's own keys (the editor's Esc)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`금제: ${banlistName(value, index)}`}
        title={banlistTitle(value, index) || undefined}
        onClick={toggle}
        onKeyDown={(e) => open && onKey(e)}
        className={`${DROPDOWN_BOX} shrink-0 h-7 pl-2 pr-1.5 rounded-lg text-xs tabular-nums`}
      >
        <span className="min-w-0 truncate">{banlistName(value, index)}</span>
        <ChevronDown aria-hidden className={`shrink-0 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="금제 고르기"
          // at the page's end: whatever holds the button and closes on a press outside it leaves this alone
          data-dex-overlay
          onKeyDown={onKey}
          style={place ? { position: "fixed", ...place } : { position: "fixed", top: 0, left: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT, visibility: "hidden" }}
          className="z-[60] flex overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg text-xs text-left"
        >
          <div role="tablist" aria-label="금제 종류" aria-orientation="vertical" className="shrink-0 w-[5.5rem] sm:w-24 py-1.5 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
            {BAN_KINDS.map((k) => {
              const on = k.kind === kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setKind(k.kind)}
                  className={`h-9 sm:h-8 px-3 border-0 rounded-none text-left text-xs font-semibold whitespace-nowrap transition-colors ${
                    on ? "bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300" : "bg-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" className="min-w-0 flex-1 flex flex-col gap-3 p-3">
            {kind === "custom" ? <CustomLists value={value} onPick={pick} /> : <GameLists format={kind} value={value} index={index} onPick={pick} />}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
