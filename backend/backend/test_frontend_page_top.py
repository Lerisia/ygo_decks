"""Every page starts 24px under the top bar (desktop menu bar, phone header) — pt-6 or py-6 on the page's outermost box
and no other top padding or margin there (참혈 2026-10-11). Each page used to pick its own (0 to 46px; the deck page sat
flush against the bar), so a new page has to follow it too. The kept deck and card lists that App.tsx mounts are pages
as well. Inner boxes must not add space above the first content either; that part is checked by eye."""
import re
from pathlib import Path

from django.test import SimpleTestCase

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
EXEMPT = {
    # the room screen has its own full-window layout and hides the top bar on phones
    "MultiplayerRoom",
    # drawing mode hides all site chrome
    "SoloDraw",
}
TOP_SPACING = re.compile(r"^(?:[a-z]+:)?-?(?:p|py|pt|m|my|mt)-")


def routed_pages(src):
    app = (src / "App.tsx").read_text(encoding="utf-8")
    # pages load as they are opened (2026-10-12): const X = lazyChunk(() => import("./pages/X")), or a plain import
    imports = dict(re.findall(r'import (\w+) from "\./pages/([\w/]+)"', app))
    imports |= dict(re.findall(r'const (\w+) = lazyChunk\(\(\) => import\("\./pages/([\w/]+)"\)', app))
    used = set(re.findall(r"element=\{<([A-Z]\w*)", app)) | set(re.findall(r"^\s*<([A-Z]\w*) />", app, re.M))
    return {name: src / "pages" / f"{imports[name]}.tsx" for name in sorted(used) if name in imports}


def main_root_classes(text):
    """className of the box the page component finally returns (its last outermost `return (`)."""
    name = re.search(r"export default (?:function )?(\w+)", text).group(1)
    start = re.search(r"(?:^|\n)(?:export default )?(?:function %s\b|const %s\b)" % (name, name), text).start()
    end = re.search(r"\n\};?\n", text[start:])
    body = text[start: start + end.end()] if end else text[start:]
    returns = list(re.finditer(r"\n( +)return \(\s*\n", body))
    if not returns:
        return None
    outer = min(len(r.group(1)) for r in returns)
    rest = body[[r for r in returns if len(r.group(1)) == outer][-1].end():]
    # a provider or fragment around the page: the page box is the first element with a className inside it
    m = re.search(r'<[a-z]\w*\b[^>]*?className=(?:\{`|")([^`"]*)', rest)
    return m.group(1) if m else ""


def off_standard(src):
    bad = []
    for name, path in routed_pages(src).items():
        if name in EXEMPT:
            continue
        classes = main_root_classes(path.read_text(encoding="utf-8"))
        if classes is None:
            bad.append(f"{name}: page box not found")
            continue
        top = [c for c in classes.split() if TOP_SPACING.match(c) and not re.match(r"^(?:[a-z]+:)?(?:pb|mb)-", c)]
        if sorted(top) not in (["pt-6"], ["py-6"]):
            bad.append(f"{name}: {' '.join(top) or '(no top padding)'}")
    return bad


class PageTopTest(SimpleTestCase):
    def test_every_page_starts_24px_under_the_top_bar(self):
        if not SRC.exists():
            self.skipTest("frontend not checked out next to the backend")
        self.assertEqual(off_standard(SRC), [], "pages whose outer box isn't pt-6 / py-6 alone at the top")
