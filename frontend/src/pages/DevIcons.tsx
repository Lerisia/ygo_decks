import { useEffect, useState, type ReactNode } from "react";
import { getIconChoices, saveIconChoices, type IconChoice, type IconChoices, type IconLib } from "@/api/devIconsApi";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { FA_REGULAR, FA_SOLID, MATERIAL_ICONS, MATERIAL_SYMBOLS, REMIX_FILL, REMIX_LINE, type Glyph } from "@/lib/iconSamples";
import { type RemixTyped, remixKey, remixTyped } from "@/lib/remixName";

function Icon({ g, size, className = "" }: { g: Glyph; size: number; className?: string }) {
  return (
    <svg viewBox={g.vb} width={size} height={size} fill="currentColor" aria-hidden className={`shrink-0 ${className}`}>
      {g.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** fa: Font Awesome Free names, rx: Remix Icon names (none where Remix has nothing near). */
type Row = { emoji: string; where: string; fa: string[]; rx: string[] };
type Gap = Row & { note: string; mi?: string[]; sym?: string[]; tint?: string[] };

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "1. 상단 메뉴 · 하단 탭바 · 더보기",
    rows: [
      { emoji: "📢", where: "공지", fa: ["bullhorn"], rx: ["megaphone"] },
      { emoji: "💬", where: "문의", fa: ["comment-dots"], rx: ["chat-3", "question-answer"] },
      { emoji: "☕", where: "후원", fa: ["mug-hot"], rx: ["cup"] },
      { emoji: "🎁", where: "출석 보너스", fa: ["gift"], rx: ["gift"] },
      { emoji: "📚", where: "도감 탭", fa: ["book", "book-open"], rx: ["book-2", "book-open"] },
      { emoji: "🧰", where: "도구 탭", fa: ["toolbox"], rx: ["tools"] },
      { emoji: "📝", where: "전적 탭", fa: ["pen-to-square"], rx: ["edit-box", "file-edit"] },
      { emoji: "🎮", where: "놀이터 탭", fa: ["gamepad"], rx: ["gamepad"] },
      { emoji: "☰", where: "더보기", fa: ["bars"], rx: ["menu"] },
      { emoji: "🌙", where: "어둡게", fa: ["moon"], rx: ["moon"] },
      { emoji: "☀️", where: "밝게", fa: ["sun"], rx: ["sun"] },
      { emoji: "👤", where: "내 정보", fa: ["circle-user"], rx: ["account-circle"] },
      { emoji: "⚙️", where: "기타 · 설정", fa: ["gear"], rx: ["settings-3"] },
    ],
  },
  {
    title: "2. 공통 버튼과 표시",
    rows: [
      { emoji: "🔍", where: "검색", fa: ["magnifying-glass"], rx: ["search"] },
      { emoji: "✕", where: "닫기", fa: ["xmark"], rx: ["close"] },
      { emoji: "✓", where: "확인", fa: ["check"], rx: ["check"] },
      { emoji: "↗", where: "외부 링크", fa: ["arrow-up-right-from-square"], rx: ["external-link"] },
      { emoji: "🔒", where: "잠금", fa: ["lock"], rx: ["lock"] },
      { emoji: "🗑", where: "삭제", fa: ["trash-can"], rx: ["delete-bin"] },
      { emoji: "✏️", where: "수정", fa: ["pen", "pencil"], rx: ["pencil", "edit-2"] },
      { emoji: "⚠️", where: "경고", fa: ["triangle-exclamation"], rx: ["error-warning"] },
      { emoji: "⏳", where: "대기", fa: ["hourglass-half"], rx: ["hourglass-2"] },
      { emoji: "🕐", where: "시간", fa: ["clock"], rx: ["time"] },
      { emoji: "🔔", where: "알림", fa: ["bell"], rx: ["notification-3"] },
      { emoji: "🔗", where: "링크", fa: ["link"], rx: ["link"] },
      { emoji: "🔄", where: "새로고침", fa: ["arrows-rotate"], rx: ["refresh"] },
      { emoji: "↶", where: "되돌리기", fa: ["rotate-left"], rx: ["arrow-go-back"] },
      { emoji: "↺", where: "다시", fa: ["rotate-right"], rx: ["arrow-go-forward"] },
      { emoji: "💾", where: "저장", fa: ["floppy-disk"], rx: ["save"] },
      { emoji: "📋", where: "목록 · 규칙", fa: ["clipboard-list"], rx: ["clipboard", "file-list-3"] },
      { emoji: "🔊", where: "소리 켬", fa: ["volume-high"], rx: ["volume-up"] },
      { emoji: "🔇", where: "소리 끔", fa: ["volume-xmark"], rx: ["volume-mute"] },
      { emoji: "✉️", where: "문의함", fa: ["envelope"], rx: ["mail"] },
      { emoji: "📮", where: "받은 문의", fa: ["inbox"], rx: ["inbox"] },
      { emoji: "📦", where: "덱 업데이트 공지", fa: ["box-open"], rx: ["archive"] },
      { emoji: "📊", where: "통계", fa: ["chart-column"], rx: ["bar-chart-box"] },
      { emoji: "📈", where: "추이", fa: ["chart-line"], rx: ["line-chart"] },
    ],
  },
  {
    title: "3. 덱 문서 · 놀이터 · 멀티",
    rows: [
      { emoji: "🎯", where: "상대법", fa: ["bullseye", "crosshairs"], rx: ["focus-3"] },
      { emoji: "📖", where: "덱 문서", fa: ["book-open"], rx: ["book-open"] },
      { emoji: "🏆", where: "우승", fa: ["trophy"], rx: ["trophy"] },
      { emoji: "👑", where: "1위", fa: ["crown"], rx: ["vip-crown"] },
      { emoji: "🎨", where: "그림", fa: ["palette"], rx: ["palette"] },
      { emoji: "🖼️", where: "그림 · 테두리", fa: ["image"], rx: ["image"] },
      { emoji: "🏳️", where: "항복", fa: ["flag"], rx: ["flag"] },
      { emoji: "❓", where: "질문", fa: ["circle-question"], rx: ["question"] },
      { emoji: "✋", where: "손 들기", fa: ["hand"], rx: ["hand"] },
      { emoji: "🖊", where: "펜", fa: ["pen"], rx: ["pen-nib", "ball-pen"] },
      { emoji: "🪣", where: "채우기", fa: ["fill-drip"], rx: ["paint"] },
      { emoji: "👍", where: "좋아요", fa: ["thumbs-up"], rx: ["thumb-up"] },
      { emoji: "👎", where: "싫어요", fa: ["thumbs-down"], rx: ["thumb-down"] },
      { emoji: "💡", where: "힌트", fa: ["lightbulb"], rx: ["lightbulb"] },
      { emoji: "🤝", where: "협력", fa: ["handshake"], rx: ["shake-hands"] },
      { emoji: "🎭", where: "역할", fa: ["masks-theater"], rx: [] },
      { emoji: "🧩", where: "퍼즐", fa: ["puzzle-piece"], rx: ["puzzle"] },
      { emoji: "👀", where: "보기", fa: ["eye"], rx: ["eye"] },
      { emoji: "📸", where: "사진", fa: ["camera"], rx: ["camera"] },
      { emoji: "📱", where: "휴대폰", fa: ["mobile-screen"], rx: ["smartphone"] },
      { emoji: "👻", where: "유령", fa: ["ghost"], rx: ["ghost"] },
      { emoji: "🚪", where: "나가기", fa: ["door-open"], rx: ["door-open"] },
      { emoji: "🛍️", where: "상점", fa: ["bag-shopping"], rx: ["shopping-bag"] },
      { emoji: "🪙", where: "포인트", fa: ["coins"], rx: ["copper-coin"] },
      { emoji: "🏷️", where: "태그", fa: ["tag"], rx: ["price-tag-3"] },
      { emoji: "🪄", where: "도구", fa: ["wand-magic-sparkles"], rx: ["magic"] },
      { emoji: "📜", where: "문서", fa: ["scroll"], rx: ["file-paper-2"] },
      { emoji: "📁", where: "폴더", fa: ["folder"], rx: ["folder"] },
      { emoji: "♪", where: "테두리 음표", fa: ["music"], rx: ["music-2"] },
    ],
  },
];

// Font Awesome Free has no match: what it has nearest, then Remix's and Material's (참혈 2026-10-15)
const GAPS: Gap[] = [
  { emoji: "⚔️", where: "대결", fa: ["shield-halved", "hand-fist"], rx: ["sword"], sym: ["swords"], note: "칼은 Font Awesome 유료판에만 있음 · Remix에는 있음 · Material Icons(MUI)에는 없음" },
  {
    emoji: "🎴", where: "카드 게임", fa: ["clone", "layer-group"], rx: ["poker-spades", "poker-hearts"], mi: ["style", "casino"], sym: ["playing_cards"],
    note: "트럼프 카드는 Font Awesome 유료판에만 있음 · Remix는 카드 무늬(스페이드·하트)",
  },
  { emoji: "🎉", where: "축하", fa: ["champagne-glasses"], rx: ["cake-3", "sparkling"], mi: ["celebration"], sym: ["celebration"], note: "파티 나팔은 Font Awesome 유료판에만 있음 · Remix도 없어 비슷한 것" },
  { emoji: "🐤", where: "멀티 게임 마스코트", fa: ["kiwi-bird", "dove"], rx: [], mi: ["flutter_dash"], sym: ["flutter_dash", "raven"], note: "병아리는 어느 쪽에도 없음 · Remix는 새도 없음" },
  {
    emoji: "🥇🥈🥉", where: "1·2·3등", fa: ["medal"], rx: ["medal", "medal-2", "award"], mi: ["military_tech", "workspace_premium"], sym: ["military_tech", "workspace_premium"],
    tint: ["text-yellow-500", "text-gray-400", "text-amber-700"], note: "숫자가 든 메달은 어느 쪽에도 없음: 한 모양을 금·은·동 색으로",
  },
  { emoji: "💯", where: "만점", fa: [], rx: [], note: "Font Awesome · Remix · Material 모두 없음: 이모지를 두거나 글자로" },
];

const SIZES = [16, 20, 24, 32];
const CELL = "flex items-center justify-center w-12 h-12 rounded-lg bg-gray-50 dark:bg-gray-900/40";
const chip = (on: boolean) =>
  `h-8 px-3 rounded-lg text-sm font-semibold hover:border-transparent ${on ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"}`;
const LIB_LABEL: Record<IconLib, string> = {
  fa: "Font Awesome", "fa-regular": "Font Awesome 외곽선", "remix-fill": "Remix 면", "remix-line": "Remix 선",
  "material-icons": "Material Icons", "material-symbols": "Material Symbols",
};
// the same icon in another style is the same pick: Remix 면 ↔ 선, Font Awesome ↔ its 외곽선
const family = (lib: IconLib) => lib.replace(/-(regular|fill|line)$/, "");
const rowKey = (r: Row) => `${r.emoji} ${r.where}`;

// every Remix icon, for the names typed by hand (~470KB gzipped, fetched once when first needed)
type RemixAll = Record<string, string[][]>;
let remixAll: Promise<RemixAll> | null = null;
const loadRemixAll = () => (remixAll ??= import("@/lib/remixIconsAll.json").then((m) => m.default.icons as RemixAll));

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[6rem] truncate" title={label}>{label}</span>
    </div>
  );
}

/** /dev/icons (operators only): the emoji the site draws its marks with, beside the free Font Awesome and Remix icons
 *  that could take their place, and Material's where Font Awesome has none (참혈 2026-10-15). A press picks one icon
 *  for each emoji, a dashed box takes any Remix name from remixicon.com, and 저장 keeps the picks on the server for the
 *  coding bot to read (/api/dev/icon-choices/, 참혈 2026-10-15). */
export default function DevIcons() {
  const admin = useAdminOnly();
  const [size, setSize] = useState(20);
  const [regular, setRegular] = useState(false);
  // filled first: line icons looked too thin for the site (참혈 2026-10-15, of Material)
  const [rxLine, setRxLine] = useState(false);
  const [choices, setChoices] = useState<Record<string, IconChoice>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<IconChoices | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [all, setAll] = useState<RemixAll | null>(null);
  const [typing, setTyping] = useState<{ row: string; text: string; error: string; listed: string[] } | null>(null);

  useEffect(() => {
    if (!admin) return;
    getIconChoices()
      .then((c) => {
        setChoices(c.choices ?? {});
        setCustom(c.custom ?? {});
        setSaved(c);
        if (Object.keys(c.custom ?? {}).length) loadRemixAll().then(setAll).catch(() => {});
      })
      .catch((e: Error) => setMsg(e.message));
  }, [admin]);
  // leaving with picks not saved asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!admin) return <div className="min-h-screen" />;
  const fa = (name: string) => (regular && FA_REGULAR[name]) || FA_SOLID[name];
  const faLib = (name: string): IconLib => (regular && FA_REGULAR[name] ? "fa-regular" : "fa");
  const rxGlyph = (name: string, line = rxLine): Glyph | undefined => {
    const known = (line ? REMIX_LINE : REMIX_FILL)[name];
    if (known) return known;
    const d = all?.[name];
    return d && { vb: "0 0 24 24", d: line ? d[1] ?? d[0] : d[0] };
  };
  const rx = (name: string) => rxGlyph(name)!;
  const rxLib: IconLib = rxLine ? "remix-line" : "remix-fill";
  // a name typed with its style keeps it; one typed bare follows the 면/선 switch (참혈 2026-10-16)
  const typedLib = (t: RemixTyped): IconLib => (t.style ? `remix-${t.style}` : rxLib);
  const glyphOf = (c: IconChoice): Glyph | undefined =>
    c.lib === "fa" ? FA_SOLID[c.name] : c.lib === "fa-regular" ? FA_REGULAR[c.name]
      : c.lib === "remix-fill" || c.lib === "remix-line" ? rxGlyph(c.name, c.lib === "remix-line")
        : (c.lib === "material-icons" ? MATERIAL_ICONS : MATERIAL_SYMBOLS)[c.name];

  const pick = (row: string, lib: IconLib, name: string) => {
    setChoices((all) => {
      const was = all[row];
      const next = { ...all };
      if (was && was.lib === lib && was.name === name) delete next[row];
      else next[row] = { lib, name };
      return next;
    });
    setDirty(true);
    setMsg("");
  };
  const isPicked = (row: string, lib: IconLib, name: string) => {
    const c = choices[row];
    return !!c && c.name === name && family(c.lib) === family(lib);
  };
  const save = () => {
    setSaving(true);
    saveIconChoices(choices, custom)
      .then((c) => {
        setSaved(c);
        setDirty(false);
        setMsg("저장했습니다.");
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setSaving(false));
  };
  const typeName = (row: string, listed: string[]) => {
    setTyping({ row, text: custom[row] ?? "", error: "", listed });
    loadRemixAll().then(setAll).catch(() => setTyping((t) => t && { ...t, error: "Remix 목록을 불러오지 못했습니다." }));
  };
  const takeName = () => {
    if (!typing) return;
    const typed = remixTyped(typing.text);
    const { name } = typed;
    if (!name) return setTyping(null);
    if (!all) return setTyping({ ...typing, error: "Remix 목록을 불러오는 중입니다." });
    if (!all[name]) return setTyping({ ...typing, error: `Remix에 '${name}'이(가) 없습니다.` });
    // already among the row's own and typed bare: just picked, not shown twice
    if (typed.style || !typing.listed.includes(name)) setCustom((c) => ({ ...c, [typing.row]: remixKey(typed) }));
    setChoices((c) => ({ ...c, [typing.row]: { lib: typedLib(typed), name } }));
    setDirty(true);
    setMsg("");
    setTyping(null);
  };
  const dropName = (row: string) => {
    const { name } = remixTyped(custom[row] ?? "");
    setCustom(({ [row]: _, ...rest }) => rest);
    setChoices((c) => {
      if (c[row]?.name !== name || family(c[row].lib) !== "remix") return c;
      const { [row]: __, ...rest } = c;
      return rest;
    });
    setDirty(true);
  };

  type Kind = "emoji" | "fa" | "rx" | "picked";
  const KINDS: [Kind, string][] = [["emoji", "지금"], ["fa", "Font Awesome"], ["rx", `Remix (${rxLine ? "선" : "면"})`], ["picked", "고른 것"]];
  const mark = (kind: Kind, row: string, emoji: string, faName: string, rxName: string, px: number) => {
    if (kind === "emoji") return emoji;
    const g = kind === "fa" ? fa(faName) : kind === "rx" ? rx(rxName) : choices[row] && glyphOf(choices[row]);
    return g ? <Icon g={g} size={px} /> : emoji;
  };

  const pill = "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap px-3 py-1.5 text-sm";
  const navButtons = (kind: Kind) => (
    <div className="flex items-center gap-1.5">
      <span className={`${pill} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800`}>
        {mark(kind, "📢 공지", "📢", "bullhorn", "megaphone", 14)}<span>공지</span>
      </span>
      <span className={`${pill} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800`}>
        {mark(kind, "💬 문의", "💬", "comment-dots", "chat-3", 14)}<span>문의</span>
      </span>
      <span className={`${pill} bg-rose-600 text-white`}>{mark(kind, "☕ 후원", "☕", "mug-hot", "cup", 14)}<span>후원</span></span>
    </div>
  );
  const tabs: [string, string, string, string, string][] = [
    ["📚", "book", "book-2", "도감", "📚 도감 탭"], ["🧰", "toolbox", "tools", "도구", "🧰 도구 탭"], ["📝", "pen-to-square", "edit-box", "전적", "📝 전적 탭"],
    ["🎮", "gamepad", "gamepad", "놀이터", "🎮 놀이터 탭"], ["☰", "bars", "menu", "더보기", "☰ 더보기"],
  ];
  const tabBar = (kind: Kind) => (
    <div className="w-full max-w-sm flex justify-around items-center h-16 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      {tabs.map(([emoji, faName, rxName, label, row], i) => {
        const icon = mark(kind, row, emoji, faName, rxName, 20);
        return (
          <span key={label} className={`flex flex-col items-center justify-center flex-1 h-full text-xs ${i === 0 ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}>
            {typeof icon === "string" ? <span className="text-xl">{icon}</span> : <span className="h-7 flex items-center">{icon}</span>}
            <span className="mt-1">{label}</span>
          </span>
        );
      })}
    </div>
  );

  type Item = { lib: IconLib; name: string; g: Glyph };
  const cell = (row: string, it: Item, tints: string[] = [""]) => {
    const on = isPicked(row, it.lib, it.name);
    return (
      <Labeled key={`${it.lib}:${it.name}`} label={it.name}>
        <button
          type="button"
          onClick={() => pick(row, it.lib, it.name)}
          aria-pressed={on}
          title={`${LIB_LABEL[it.lib]} · ${it.name}`}
          className={`${CELL} relative p-0 border-0 ${tints.length > 1 ? "w-auto px-2 gap-1" : ""} ${on ? "ring-2 ring-blue-600 bg-blue-50 dark:bg-blue-900/30" : "hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"}`}
        >
          {tints.map((t) => <Icon key={t} g={it.g} size={size} className={t} />)}
          {on && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] leading-4 text-center">✓</span>}
        </button>
      </Labeled>
    );
  };
  // the dashed box: a Remix name typed by hand (remixicon.com), shown and picked like the rest
  const typedCell = (row: string, listed: string[], tints: string[] = [""]) => {
    if (typing?.row === row) {
      return (
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            value={typing.text}
            onChange={(e) => setTyping({ ...typing, text: e.target.value, error: "" })}
            onKeyDown={(e) => {
              if (e.key === "Enter") takeName();
              if (e.key === "Escape") setTyping(null);
            }}
            onBlur={() => !typing.text.trim() && setTyping(null)}
            enterKeyHint="done"
            placeholder="Remix 이름"
            aria-label="Remix 아이콘 이름"
            className="w-36 h-12 px-2 rounded-lg border border-dashed border-blue-400 bg-white dark:bg-gray-900 text-sm"
          />
          <span className={`text-[11px] max-w-[9rem] break-keep ${typing.error ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
            {typing.error || (all ? "Enter로 고르기 · 예: sword, search-line" : "목록 불러오는 중…")}
          </span>
        </div>
      );
    }
    const typed = custom[row] ? remixTyped(custom[row]) : null;
    const name = typed?.name;
    const g = typed ? rxGlyph(typed.name, typed.style ? typed.style === "line" : rxLine) : undefined;
    if (typed && name && g) {
      return (
        <div className="relative">
          {cell(row, { lib: typedLib(typed), name, g }, tints)}
          <button
            type="button"
            onClick={() => dropName(row)}
            aria-label={`${name} 지우기`}
            className="absolute -top-1.5 -left-1.5 w-4 h-4 p-0 border-0 rounded-full bg-gray-500 text-white text-[10px] leading-4"
          >
            ✕
          </button>
        </div>
      );
    }
    return (
      <Labeled label={name ? `${name} 불러오는 중` : "이름 넣기"}>
        <button
          type="button"
          onClick={() => typeName(row, listed)}
          title="remixicon.com에서 찾은 이름을 넣습니다"
          className={`${CELL} p-0 bg-transparent border border-dashed border-gray-400 dark:border-gray-500 text-gray-400 hover:text-blue-600 hover:border-blue-400`}
        >
          +
        </button>
      </Labeled>
    );
  };
  const group = (row: string, label: string, items: Item[], tints?: string[], typed = false) => (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => cell(row, it, tints))}
        {!items.length && !typed && <span className={`${CELL} text-xs text-gray-400 dark:text-gray-500`}>없음</span>}
        {typed && typedCell(row, items.map((it) => it.name), tints)}
      </div>
    </div>
  );
  const faItems = (names: string[]): Item[] => names.map((n) => ({ lib: faLib(n), name: n, g: fa(n) }));
  const rxItems = (names: string[]): Item[] => names.map((n) => ({ lib: rxLib, name: n, g: rx(n) }));
  const picked = (row: string) => {
    const c = choices[row];
    return (
      <span className="text-[11px] text-blue-700 dark:text-blue-300 max-w-[5.5rem] break-keep">
        {c ? `${LIB_LABEL[c.lib]} ${c.name}` : ""}
      </span>
    );
  };
  const count = Object.keys(choices).length;
  const savedAt = saved?.saved_at ? new Date(saved.saved_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6 text-left">
      <h1 className="text-xl font-bold">아이콘 견본</h1>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
        지금 쓰는 이모지와 바꿀 수 있는 Font Awesome 무료 아이콘(7.3.1)·Remix Icon(4.9.1)입니다. Remix는 아이콘마다 면(채움)과 선 두 가지가
        있습니다. 둘 다 맞는 게 없는 것은 Material Icons(MUI가 쓰는 것)와 Material Symbols도 함께 놓았습니다. 이모지는 기기마다 그림이 다르니
        휴대폰에서도 열어 보세요.
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
        아이콘을 누르면 그 줄에 쓸 것으로 고르고, 다시 누르면 풉니다. 점선 칸에는 remixicon.com에서 찾은 이름을 넣을 수 있습니다(예: sword,
        search-line). 뒤에 -fill·-line을 붙이면 그대로 쓰고, 안 붙이면 위의 면/선 설정을 따릅니다. 다 고르면 아래 저장을 누르세요. 저장한 내용은 코딩봇이 읽습니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-300">크기</span>
          <div className="flex gap-1">
            {SIZES.map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)} className={chip(s === size)}>{s}px</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-300">Remix</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => setRxLine(false)} className={chip(!rxLine)}>면</button>
            <button type="button" onClick={() => setRxLine(true)} className={chip(rxLine)}>선</button>
          </div>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={regular} onChange={(e) => setRegular(e.target.checked)} />
          Font Awesome 외곽선형(Regular)이 있으면 그것으로
        </label>
      </div>

      <section className="mt-6">
        <h2 className="text-base font-bold">실제 자리에 넣어 보기</h2>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
            {KINDS.map(([kind, label]) => (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">상단 버튼 · {label}</span>
                {navButtons(kind)}
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
            {KINDS.map(([kind, label]) => (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">하단 탭바 · {label}</span>
                {tabBar(kind)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {SECTIONS.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-base font-bold">{s.title}</h2>
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {s.rows.map((r) => {
              const row = rowKey(r);
              return (
                <div key={row} className={`flex items-start gap-4 rounded-xl border p-2.5 ${choices[row] ? "border-blue-300 dark:border-blue-700" : "border-gray-200 dark:border-gray-700"}`}>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 break-keep">{r.where}</span>
                    <span className={CELL} style={{ fontSize: size }}>{r.emoji}</span>
                    {picked(row)}
                  </div>
                  {group(row, "Font Awesome", faItems(r.fa))}
                  {group(row, `Remix · ${rxLine ? "선" : "면"}`, rxItems(r.rx), undefined, true)}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-base font-bold">4. Font Awesome 무료판에 딱 맞는 게 없는 것</h2>
        <div className="mt-2 flex flex-col gap-2">
          {GAPS.map((r) => {
            const row = rowKey(r);
            return (
              <div key={row} className={`rounded-xl border p-3 flex flex-wrap items-start gap-x-6 gap-y-3 ${choices[row] ? "border-blue-300 dark:border-blue-700" : "border-gray-200 dark:border-gray-700"}`}>
                <div className="flex items-center gap-3 w-40 shrink-0">
                  <span className={`${CELL} ${r.emoji.length > 2 ? "w-auto px-2" : ""}`} style={{ fontSize: size }}>{r.emoji}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold break-keep">{r.where}</span>
                    {picked(row)}
                  </span>
                </div>
                {group(row, "Font Awesome (비슷한 것)", faItems(r.fa), r.tint)}
                {group(row, `Remix · ${rxLine ? "선" : "면"}`, rxItems(r.rx), r.tint, true)}
                {r.mi && group(row, "Material Icons · MUI", r.mi.map((n) => ({ lib: "material-icons" as const, name: n, g: MATERIAL_ICONS[n] })), r.tint)}
                {r.sym && group(row, "Material Symbols", r.sym.map((n) => ({ lib: "material-symbols" as const, name: n, g: MATERIAL_SYMBOLS[n] })), r.tint)}
                <p className="basis-full text-xs text-gray-500 dark:text-gray-400 break-keep">{r.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-[11px] text-gray-400 dark:text-gray-500 break-keep">
        Font Awesome Free 7.3.1 (아이콘 CC BY 4.0) · Remix Icon 4.9.1 (Remix Icon License v1.0: 사이트 UI 사용 가능, 로고·앱 아이콘으로는 금지) ·
        Material Icons, Material Symbols by Google (Apache 2.0). 이 페이지에만 그림을 복사해 두었고 패키지는 설치하지 않았습니다.
      </p>

      {/* the save bar stays in sight above a phone's tab bar */}
      <div className="sticky bottom-20 sm:bottom-4 z-40 mt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 shadow-lg px-4 py-2.5">
          <span className="text-sm font-semibold">고른 아이콘 {count}개</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 break-keep">
            {msg || (dirty ? "저장하지 않은 변경이 있습니다." : saved?.saved_at ? `마지막 저장: ${saved.saved_by} · ${savedAt}` : "아직 저장한 적이 없습니다.")}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="ml-auto h-9 px-4 rounded-lg font-semibold transition bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
