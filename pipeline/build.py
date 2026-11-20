"""Merge the scraped pages and the merged findings into one self-contained review page.

    python pipeline/build.py nl   -> out/review-nl.html
    python pipeline/build.py en   -> out/review-en.html

Open it through a local web server (start.command does that): the PDF panes and
the saved verdicts do not work reliably on file://.
"""
import json, os, sys
import pages as pageset
import project

SOURCES = {
    "claude": {"key": "claude", "name": "Reviewer", "short": "Reviewer"},
    "lt": {"key": "lt", "name": "LanguageTool", "short": "LanguageTool"},
}


def target(lang):
    T = project.TARGETS[lang]
    others = [l for l in project.TARGETS if l != lang]
    return {
        "code": lang, "short": lang.upper(), "name": T["name"],
        # browser storage keys: one set per project and language
        "store": f"vidimus-{project.CFG['short']}-{lang}-v1".lower().replace(" ", "-"),
        "docKey": f"vidimus-doc-{lang}", "panesKey": f"vidimus-panes-{lang}",
        "panes": T["panes"],
        "checked": f"gecontroleerd tegen de {lang.upper()}-PDF",
        "switch": ({"label": f"{others[0].upper()}-nalezing ↗", "href": f"review-{others[0]}.html"}
                   if others else {"label": "", "href": "#"}),
        "title": None,
    }


def main(lang):
    T = project.TARGETS[lang]
    sc = pageset.load()
    fi = project.load_json(f"findings_{lang}.json")
    src = project.SOURCE

    pages = []
    for key, page in sc.items():
        fr = page["langs"][src]["blocks"]
        tg = page["langs"][lang]["blocks"]
        pages.append({
            "key": key,
            "label": project.UI_LABELS.get(key, key),
            "fr_url": page["langs"][src]["url"],
            "tgt_url": page["langs"][lang]["url"],
            "blocks": [dict({"tag": f["tag"], "fr": f["text"], "tgt": t["text"]},
                            **({"meta": True} if t.get("meta") else {}))
                       for f, t in zip(fr, tg)],
        })

    findings = []
    for f in fi:
        g = dict(f)
        g["tgt"] = f[lang]
        g["others"] = f.get("others") or []
        g["filter"] = f.get("filter", "")
        findings.append(g)

    sources = [SOURCES["claude"]]
    if any("lt" in f["sources"] for f in fi):
        sources.append(SOURCES["lt"])
    if any("qa" in f["sources"] for f in fi):
        q = T.get("qaName", "QA")
        sources.append({"key": "qa", "name": q, "short": q})

    # The PDFs mkpdf.py printed, with the first PDF page of each site page,
    # so picking a section can jump the panes.
    starts = project.load_json("pdf", "starts.json") if os.path.exists(project.out("pdf", "starts.json")) else {}
    pdfs = []
    from pypdf import PdfReader
    for code in T["panes"]:
        fname = project.out("pdf", f"{code}.pdf")
        if not os.path.exists(fname):
            print(f"  missing: out/pdf/{code}.pdf")
            continue
        name = project.TARGETS.get(code, {}).get("name") or {"fr": "Frans"}.get(code, code.upper())
        pdfs.append({"key": code, "label": name + (" (bron)" if code == src else ""),
                     "file": f"pdf/{code}.pdf", "pages": len(PdfReader(fname).pages),
                     "starts": starts.get(code, {})})

    data = {"pages": pages, "findings": findings, "pdfs": pdfs,
            "project": {"name": project.CFG["name"], "short": project.CFG["short"],
                        "version": project.CFG.get("version", "")},
            "target": target(lang),
            "sources": sources, "ltSkip": T.get("ltSkip", []),
            "migrate": {"tag": "", "map": {}}}
    blob = json.dumps(data, ensure_ascii=False).replace("</script>", "<\\/script>")
    html = open(project.root("desk", "template.html"), encoding="utf-8").read().replace("__DATA__", blob)
    out = project.out(f"review-{lang}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"out/review-{lang}.html  {len(html)/1024:.0f} KB  "
          f"{sum(len(p['blocks']) for p in pages)} blocks  {len(findings)} findings  {len(pdfs)} pdfs")


if __name__ == "__main__":
    main(project.target(sys.argv))
