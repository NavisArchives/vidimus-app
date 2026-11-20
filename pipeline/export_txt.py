"""Plain-text and CSV exports of the site copy, for an external translation checker.

    python pipeline/export_txt.py   -> out/export/
"""
import csv, os
import project

NAMES = {"fr": "Frans", "nl": "Nederlands", "en": "Engels"}
HEAD = {"h1": "# ", "h2": "## ", "h3": "### ", "h4": "#### "}
SRC = project.SOURCE
NAME = project.CFG["short"]


def one_language(sc, lang, title):
    out = [title, "=" * len(title), f"{project.CFG['name']}, {project.CFG.get('version', '')}".rstrip(", "),
           f"Bron: de site ({SRC.upper()} = referentie, de andere talen = te controleren)", ""]
    for key, page in sc.items():
        out += ["", "=" * 78, f"PAGINA: {project.LABELS[key]}", page["langs"][lang]["url"], "=" * 78, ""]
        for b in page["langs"][lang]["blocks"]:
            if len(b["text"]) >= 2:
                out.append(HEAD.get(b["tag"], "") + b["text"])
    return "\n".join(out) + "\n"


def aligned(sc, lang):
    up = lang.upper()
    out = [f"{NAME}, {NAMES.get(SRC, SRC)} en {NAMES.get(lang, lang)} naast elkaar",
           f"Elk blok: {SRC.upper()} dan {up}. Identieke regels = nog niet vertaald.", ""]
    for key, page in sc.items():
        out += ["", "=" * 78, f"PAGINA: {project.LABELS[key]}", "=" * 78, ""]
        for i, (f, t) in enumerate(zip(page["langs"][SRC]["blocks"], page["langs"][lang]["blocks"])):
            if len(f["text"]) < 2:
                continue
            flag = "   <-- IDENTIEK" if f["text"] == t["text"] and len(f["text"]) > 12 else ""
            out += [f"[{key}#{i}] <{f['tag']}>{flag}", f"{SRC.upper()}: {f['text']}", f"{up}: {t['text']}", ""]
    return "\n".join(out) + "\n"


def csv_pairs(sc, lang, path):
    """A spreadsheet-friendly version for tools that want columns."""
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["id", "pagina", "tag", NAMES.get(SRC, SRC).lower(), NAMES.get(lang, lang).lower(), "identiek"])
        for key, page in sc.items():
            for i, (a, b) in enumerate(zip(page["langs"][SRC]["blocks"], page["langs"][lang]["blocks"])):
                if len(a["text"]) >= 2:
                    w.writerow([f"{key}#{i}", project.LABELS[key], a["tag"], a["text"], b["text"],
                                "ja" if a["text"] == b["text"] else ""])


def main():
    sc = project.load_json("scraped.json")
    files = {f"{lang}.txt": one_language(sc, lang, f"{NAME}, {NAMES.get(lang, lang)}") for lang in project.CFG["langs"]}
    for lang in project.TARGETS:
        files[f"{SRC}-{lang}-naast-elkaar.txt"] = aligned(sc, lang)
    for name, body in files.items():
        with open(project.out("export", name), "w", encoding="utf-8") as f:
            f.write(body)
    for lang in project.TARGETS:
        csv_pairs(sc, lang, project.out("export", f"{SRC}-{lang}.csv"))
    d = project.out("export", "x")[:-2]
    for n in sorted(os.listdir(d)):
        print(f"  out/export/{n:28s} {os.path.getsize(os.path.join(d, n))/1024:6.1f} KB")


if __name__ == "__main__":
    main()
