import type { ReactNode } from "react";

/** Every search box sits in one of these, with enterKeyHint="search" on its input: Enter — the phone keyboard's 검색
 *  key — ends the typing, so the keyboard goes away (and onSearch runs, for boxes that search on Enter). A form
 *  submit is used rather than an Enter key handler because it also fires while a Korean syllable is still being
 *  composed. The form draws no box of its own (display: contents), so wrapping a box never moves it. */
export default function SearchForm({ onSearch, children }: { onSearch?: () => void; children: ReactNode }) {
  return (
    <form
      role="search"
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch?.();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      {children}
    </form>
  );
}
