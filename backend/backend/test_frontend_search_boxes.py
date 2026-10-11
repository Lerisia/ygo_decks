"""Every search box on the site ends its typing on Enter — the phone keyboard's 검색 key puts the keyboard away.
That is SearchForm (frontend/src/components/SearchForm.tsx) around the input plus enterKeyHint="search" on it; boxes
kept apart from that list why below. Missing it is the usual slip with a new search box (엘리스 2026-10-11)."""
import re
from pathlib import Path

from django.test import SimpleTestCase

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
SEARCH_WORDS = re.compile(r'placeholder=\{?"[^"]*(검색|찾기)[^"]*"')
EXEMPT = {
    # already inside the points-grant form, whose Enter submits the grant
    ("pages/AdminPointsGrant.tsx", "닉네임 일부를 입력하면 검색"),
}


def jsx_inputs(text):
    """Each <input …/> or <Input …/> element in a .tsx file, whole even when an attribute holds "=>" or ">"."""
    for m in re.finditer(r"<(input|Input)\b", text):
        depth, quote, i = 0, None, m.end()
        while i < len(text):
            ch = text[i]
            if quote:
                quote = None if ch == quote else quote
            elif ch in "\"'`":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            elif depth == 0 and text.startswith("/>", i):
                yield text[m.start(): i + 2]
                break
            i += 1


def unhandled_search_boxes(src):
    missing = []
    for path in src.rglob("*.tsx"):
        text = path.read_text(encoding="utf-8")
        for element in jsx_inputs(text):
            hit = re.search(r'placeholder=\{?"([^"]*)"', element)
            if not hit or not SEARCH_WORDS.search(element):
                continue
            rel = str(path.relative_to(src))
            if (rel, hit.group(1)) in EXEMPT:
                continue
            if 'enterKeyHint="search"' not in element or "SearchForm" not in text:
                missing.append(f"{rel}: {hit.group(1)}")
    return sorted(missing)


class SearchBoxTest(SimpleTestCase):
    def test_every_search_box_puts_the_keyboard_away_on_enter(self):
        if not SRC.exists():
            self.skipTest("frontend not checked out next to the backend")
        self.assertEqual(unhandled_search_boxes(SRC), [], "search boxes without SearchForm + enterKeyHint=\"search\"")
