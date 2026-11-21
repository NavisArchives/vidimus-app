"""Tests for the lab desks: the invented sample, the build's own checks, the
icon sprite and the built pages.

    python -m unittest discover -s tests
"""
import copy, json, os, re, sys, unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
LAB = os.path.join(ROOT, "lab")
sys.path.insert(0, LAB)
import build  # noqa: E402


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


DATA = json.loads(read(os.path.join(LAB, "sample", "findings.json")))
PDF = os.path.join(LAB, "sample", DATA["document"]["file"])
try:
    import pypdf  # noqa: F401
    TEXTS = build.page_texts(PDF)
except ImportError:  # the checks against the PDF need pypdf (requirements.txt)
    TEXTS = None


class Sample(unittest.TestCase):
    def test_between_twelve_and_twenty_findings(self):
        self.assertTrue(12 <= len(DATA["findings"]) <= 20)

    def test_every_type_and_severity_is_used(self):
        self.assertEqual({f["type"] for f in DATA["findings"]}, build.TYPES)
        self.assertEqual({f["severity"] for f in DATA["findings"]}, build.SEVERITIES)

    def test_every_agent_flags_something(self):
        flagged = {a for f in DATA["findings"] for a in f["agents"]}
        self.assertEqual(flagged, {a["key"] for a in DATA["agents"]})

    @unittest.skipIf(TEXTS is None, "pypdf not installed")
    def test_every_quote_is_once_on_its_page(self):
        self.assertEqual(build.check(DATA, TEXTS), [])

    @unittest.skipIf(TEXTS is None, "pypdf not installed")
    def test_check_catches_a_quote_that_is_not_there(self):
        bad = copy.deepcopy(DATA)
        bad["findings"][0]["quote"] = "a sentence the note never says"
        self.assertTrue(any("found 0x" in p for p in build.check(bad, TEXTS)))

    @unittest.skipIf(TEXTS is None, "pypdf not installed")
    def test_check_catches_a_suggestion_equal_to_the_quote(self):
        bad = copy.deepcopy(DATA)
        bad["findings"][0]["suggestion"] = bad["findings"][0]["quote"]
        self.assertTrue(any("suggestion equals" in p for p in build.check(bad, TEXTS)))

    def test_decisions_name_known_people(self):
        team = {u["key"] for u in DATA["team"]}
        self.assertTrue(all(d["by"] in team for d in DATA["decisions"]))


class Sprite(unittest.TestCase):
    def test_every_icon_the_desk_uses_is_in_the_sprite(self):
        sprite = build.sprite()
        have = set(re.findall(r'<symbol id="i-([\w-]+)"', sprite))
        used = set()
        for name in ["desk.js", "v1/template.html", "v2/template.html"]:
            text = read(os.path.join(LAB, name))
            used |= set(re.findall(r"\bic\('([\w-]+)'", text))
            used |= set(re.findall(r'#i-([\w-]+)"', text))
            block = re.search(r"STATUS_ICON = \{([^}]*)\}", text)
            if block:  # icons picked by status, not named in an ic() call
                used |= set(re.findall(r"'([\w-]+)'", block.group(1)))
        self.assertEqual(used - have, set())

    def test_logo_ids_are_namespaced(self):
        # two logos must never share a gradient id once they sit in one page
        ids = re.findall(r'\bid="([^"]+)"', build.sprite())
        self.assertEqual(len(ids), len(set(ids)))


class BuiltPages(unittest.TestCase):
    def test_no_placeholder_left(self):
        for d in build.DIRECTIONS:
            html = read(os.path.join(LAB, d, "index.html"))
            for mark in ("__DATA__", "/*__DESK__*/", "<!--__SPRITE__-->"):
                self.assertNotIn(mark, html, f"{d}: {mark}")

    def test_copy_has_no_long_dashes(self):
        for name in ["desk.js", "v1/template.html", "v2/template.html", "sample/findings.json", "sample/note.html"]:
            text = read(os.path.join(LAB, name))
            self.assertNotRegex(text, "[–—]", name)


if __name__ == "__main__":
    unittest.main()
