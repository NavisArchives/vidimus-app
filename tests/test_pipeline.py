"""Unit tests for the pure parts of the pipeline: block extraction, the QA
report parser, the PDF match and LanguageTool's auto-fix.

    python -m unittest discover -s tests
"""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import scrape, qa_import, findings, merge  # noqa: E402


class Extract(unittest.TestCase):
    def test_leaf_blocks_in_order(self):
        b = scrape.extract("<body><h1>Titre</h1><p>Un paragraphe.</p><ul><li>Un</li><li>Deux</li></ul></body>")
        self.assertEqual([x["text"] for x in b], ["Titre", "Un paragraphe.", "Un", "Deux"])

    def test_wrapper_keeps_its_own_text(self):
        b = scrape.extract("<body><p><span>Horaires :</span> du mardi au samedi</p></body>")
        self.assertEqual([x["text"] for x in b], ["du mardi au samedi", "Horaires :"])

    def test_comments_and_scripts_are_not_copy(self):
        b = scrape.extract("<body><div><!-- Section --><p>Texte</p></div><script>var x=1</script></body>")
        self.assertEqual([x["text"] for x in b], ["Texte"])

    def test_short_labels_and_options_count(self):
        b = scrape.extract('<body><label>Nom</label><select><option>Choisir</option></select></body>')
        self.assertEqual([x["text"] for x in b], ["Nom", "Choisir"])

    def test_same_structure_gives_same_signatures(self):
        fr = scrape.extract("<body><main><h2>Prêt</h2><p>Quatorze jours.</p></main></body>")
        nl = scrape.extract("<body><main><h2>Lenen</h2><p>Veertien dagen.</p></main></body>")
        self.assertEqual([x["sig"] for x in fr], [x["sig"] for x in nl])


class QaReport(unittest.TestCase):
    TEXT = ("Header line\n\n[home#5]\nP0 — untranslated\nCURRENT: Emprunter un livre\n"
            "REASON: Still French.\nPROPOSAL A (faithful): Een boek lenen\nPROPOSAL B (natural): Boeken lenen\n")

    def test_entries_and_fields(self):
        (bid, body), = list(qa_import.entries(self.TEXT))
        self.assertEqual(bid, "home#5")
        self.assertEqual(qa_import.field(body, r"CURRENT:", r"REASON:"), "Emprunter un livre")
        self.assertEqual(qa_import.field(body, r"PROPOSAL A\s*(\([^)]*\))?\s*:", r"PROPOSAL B"), "Een boek lenen")

    def test_typographic_quotes_and_spaces_normalise(self):
        self.assertEqual(qa_import.norm("l’accueil  ouvert"), "l'accueil ouvert")


class PdfMatch(unittest.TestCase):
    PDF = findings._norm("Elk lid kan tot vijf documenten lenen voor een periode van 14 weken. Lid worden")

    def test_still_fixed_unsure(self):
        self.assertEqual(findings._pdf_status("voor een periode van 14 weken.", "x", self.PDF), "still")
        self.assertEqual(findings._pdf_status("Devenir membre", "Lid worden", self.PDF), "fixed")
        self.assertEqual(findings._pdf_status("Iets anders", "Nog iets", self.PDF), "unsure")
        self.assertEqual(findings._pdf_status("Iets", "Iets beters", None), "unsure")


class LanguageToolFix(unittest.TestCase):
    def test_applies_first_replacement_right_to_left(self):
        ms = [{"offset": 0, "len": 3, "fix": ["The"]}, {"offset": 12, "len": 3, "fix": ["is"]}]
        self.assertEqual(merge.lt_fix("the library are open", ms), "The library is open")

    def test_no_fix_means_no_variant(self):
        self.assertEqual(merge.lt_fix("Fine text", [{"offset": 0, "len": 4, "fix": []}]), "")


if __name__ == "__main__":
    unittest.main()
