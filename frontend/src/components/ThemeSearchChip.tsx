import { useId, useMemo, useRef, useState } from "react";
import { findTheme, suggestThemes } from "@/utils/themeChips";

// Same look as the shop's filter chips (IconShop) so the search sits in the row as one of them.
export const chipClass = (active: boolean) =>
  `px-3 py-1.5 text-sm rounded-full border ${
    active ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
  }`;

const PLACEHOLDER = "🔍 검색";
const INVALID_PLACEHOLDER = "올바른 테마 입력";

interface Props {
  themes: string[];
  /** The theme filter now applied through this chip ("" = none). */
  value: string;
  onApply: (theme: string) => void;
  onClear: () => void;
}

/** A filter chip you can type a theme into: autocomplete limited to real themes, Enter applies, ✕ clears. */
export default function ThemeSearchChip({ themes, value, onApply, onClear }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [hi, setHi] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo(() => suggestThemes(text, themes), [text, themes]);

  const apply = (theme: string) => {
    onApply(theme);
    setText("");
    setOpen(false);
    setInvalid(false);
    setHi(-1);
    inputRef.current?.blur();
  };

  const submit = () => {
    const picked = hi >= 0 ? options[hi] : findTheme(text, themes);
    if (picked) return apply(picked);
    setText("");
    setInvalid(true);
    setOpen(false);
    setHi(-1);
  };

  if (value) {
    return (
      <span className={`${chipClass(true)} inline-flex items-center gap-1.5 pr-1.5`}>
        {value}
        <button
          type="button"
          onClick={onClear}
          aria-label="테마 검색 지우기"
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/30 hover:bg-white/50 text-[10px] leading-none p-0 border-0 hover:border-transparent focus:outline-none"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        value={text}
        enterKeyHint="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-invalid={invalid}
        placeholder={invalid ? INVALID_PLACEHOLDER : PLACEHOLDER}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setInvalid(false);
          setHi(-1);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
          setOpen(true);
          setHi(-1);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(i - 1, -1));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`w-32 ${chipClass(false)} outline-none focus:border-blue-500 ${
          invalid ? "!border-red-500 !bg-red-50 dark:!bg-red-900/30 placeholder:text-red-500" : ""
        }`}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full mt-1 z-30 w-48 max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1 text-left"
        >
          {options.map((t, i) => (
            <li
              key={t}
              role="option"
              aria-selected={i === hi}
              // mousedown keeps the input from blurring before the pick lands
              onMouseDown={(e) => {
                e.preventDefault();
                apply(t);
              }}
              onMouseEnter={() => setHi(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${i === hi ? "bg-blue-50 dark:bg-gray-700" : ""}`}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
