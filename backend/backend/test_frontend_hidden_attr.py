"""An element shown and hidden with the hidden attribute must not carry a display class (flex, grid, block, …): the
class's display wins over [hidden] { display: none }, so the element never hides. The picker's kept pictures did
this and every new search piled onto the last one (엘리스 2026-10-11)."""
import re
from pathlib import Path

from django.test import SimpleTestCase

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
DISPLAY = re.compile(
    r"(?<![\w:-])(?:[a-z0-9]+:)*(flex|inline-flex|grid|inline-grid|block|inline-block|inline|table|contents|flow-root)(?![\w-])"
)


def opening_tags(text):
    """Each JSX opening tag, whole even when an attribute holds "=>" or ">"."""
    for m in re.finditer(r"<[A-Za-z][\w.]*\b", text):
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
            elif depth == 0 and ch == ">":
                yield text[m.start(): i + 1]
                break
            i += 1


def class_value(tag):
    """The className attribute's value as written (a string or a {…} expression), or ""."""
    m = re.search(r"\bclassName=", tag)
    if not m:
        return ""
    i = m.end()
    if tag[i] == '"':
        return tag[i: tag.index('"', i + 1) + 1]
    depth, quote, start = 0, None, i
    while i < len(tag):
        ch = tag[i]
        if quote:
            quote = None if ch == quote else quote
        elif ch in "\"'`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return tag[start: i + 1]
        i += 1
    return tag[start:]


def hidden_with_display(src):
    found = []
    for path in src.rglob("*.tsx"):
        for tag in opening_tags(path.read_text(encoding="utf-8")):
            if not re.search(r"(?<![\w-])hidden=\{", tag):
                continue
            hit = DISPLAY.search(class_value(tag))
            if hit:
                found.append(f"{path.relative_to(src)}: {tag[:60]}… ({hit.group(0)})")
    return sorted(found)


class HiddenAttrTest(SimpleTestCase):
    def test_hidden_elements_carry_no_display_class(self):
        if not SRC.exists():
            self.skipTest("frontend not checked out next to the backend")
        self.assertEqual(hidden_with_display(SRC), [], "hidden={…} beside a display class never hides")

    def test_catches_the_picker_slip(self):
        tag = '<button key={it.key} hidden={!shown} onClick={() => pick(it)} className={`flex flex-col ${p ? "a" : "b"}`}>'
        self.assertEqual(list(opening_tags(tag)), [tag])
        self.assertTrue(DISPLAY.search(class_value(tag)))
        for fine in ('className="flex-col line-clamp-2 grid-cols-3 self-start"', 'className="hover:bg-blue-50"'):
            self.assertIsNone(DISPLAY.search(class_value(f"<div hidden={{x}} {fine}>")), fine)
        self.assertTrue(DISPLAY.search(class_value('<div hidden={x} className="sm:flex">')))
