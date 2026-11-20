# -*- coding: utf-8 -*-
"""A reviewer's findings, checked against the real blocks before they reach the desk.

    python pipeline/findings.py nl   -> out/review_nl.json
    python pipeline/findings.py en   -> out/review_en.json

The findings file (project.json → targets.<lang>.review) is a plain list, one
entry per block. Every suggestion is a FULL replacement for that block, so it
can be pasted straight into the shared document. The script refuses to run when
two findings sit on one block, when a suggestion equals the current text, or
when a finding's « contains » text is not in its block: block numbers shift
when the site changes, and a stale id must stop the run rather than put a
correction on the wrong block.

Each finding also records whether the problem is still in the target PDF (the
client's latest copy): « still », « fixed » (the PDF already carries the
suggestion) or « unsure » (neither found verbatim; check by hand).
"""
import collections, json, os, re, sys, unicodedata
import pages, project


def _norm(s):
    s = unicodedata.normalize("NFKC", s)
    for a, b in [("’", "'"), ("‘", "'"), ("ʼ", "'"), ("“", '"'),
                 ("”", '"'), ("„", '"'), (" ", " "), (" ", " "), (" ", " ")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


def _pdf_text(lang):
    """The target PDF as one normalised string: a paragraph can span a page
    break, which would otherwise split it and defeat a verbatim match."""
    path = project.out("pdf", f"{lang}.pdf")
    if not os.path.exists(path):
        return None
    from pypdf import PdfReader
    raw = " ".join(p.extract_text() or "" for p in PdfReader(path).pages)
    return _norm(raw)


def _pdf_status(cur, sugg, pdf):
    if pdf is None:
        return "unsure"
    n, s = _norm(cur), _norm(sugg)
    pdf_compact = re.sub(r"\s+", "", pdf)
    if n in pdf or re.sub(r"\s+", "", n) in pdf_compact:
        return "still"        # same wrong text in the PDF
    if s and (s in pdf or re.sub(r"\s+", "", s) in pdf_compact):
        return "fixed"        # PDF already carries the corrected wording
    return "unsure"           # genuinely not found - check by hand


def main(lang):
    sc = pages.load()
    src = project.SOURCE
    lt = project.load_json(f"langtool_{lang}.json") if os.path.exists(project.out(f"langtool_{lang}.json")) else {}
    F = json.load(open(project.root(project.TARGETS[lang]["review"]), encoding="utf-8"))
    pdf = _pdf_text(lang)

    dupes = [k for k, v in collections.Counter(f["id"] for f in F).items() if v > 1]
    assert not dupes, f"more than one finding on the same block: {dupes}"

    # keep document order so the numbering matches reading order
    order = {k: n for n, k in enumerate(sc)}
    rows = sorted(F, key=lambda f: (order[f["id"].split("#")[0]], int(f["id"].split("#")[1])))

    out = []
    for n, f in enumerate(rows, 1):
        fid = f["id"]
        page, idx = fid.split("#"); idx = int(idx)
        s_blk = sc[page]["langs"][src]["blocks"][idx]
        t_blk = sc[page]["langs"][lang]["blocks"][idx]
        sugg = f["suggestion"]
        assert sugg, f"{fid} has no suggestion"
        assert sugg != t_blk["text"], f"{fid}: the suggestion equals the current text"
        if f.get("contains"):
            assert f["contains"] in t_blk["text"], \
                f"{fid}: block no longer contains {f['contains']!r} (did the site change?): {t_blk['text']!r}"
        out.append({
            "n": n, "id": fid, "page": page, "index": idx,
            "category": f["category"], "severity": f["severity"], "title": f["title"],
            "fr": s_blk["text"], lang: t_blk["text"], "suggestion": sugg,
            "note": f.get("note", ""), "tag": t_blk["tag"],
            "lt": lt.get(page, {}).get(str(idx), []),
            "pdf": _pdf_status(t_blk["text"], sugg, pdf),
        })

    project.save_json(out, f"review_{lang}.json")
    print(f"{len(out)} findings, one per block\n")
    for k, v in collections.Counter(f["category"] for f in out).most_common():
        print(f"  {k:14s} {v}")
    print()
    for k in ("high", "medium", "low"):
        print(f"  {k:14s} {sum(1 for f in out if f['severity'] == k)}")
    print()
    for k, lbl in (("still", "still like this in the PDF"), ("fixed", "already fixed in the PDF"),
                   ("unsure", "not found verbatim in the PDF")):
        print(f"  {lbl:34s} {sum(1 for f in out if f['pdf'] == k)}")


if __name__ == "__main__":
    main(project.target(sys.argv))
