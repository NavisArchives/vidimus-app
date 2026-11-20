"""Render the invented sample (sample/source.json) as a small static site in
three languages, with the same structure in each, so the scraper can align it.

    python sample/make_site.py      -> sample/site/{,nl/,en/}<page>/index.html
"""
import html, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import project  # noqa: E402

SRC = json.load(open(os.path.join(HERE, "source.json"), encoding="utf-8"))
OUT = os.path.join(HERE, "site")
LANGS = list(project.CFG["langs"])           # fr, nl, en: the column order in source.json
W, H = project.CFG["pdf"]["width_pt"], project.CFG["pdf"]["height_pt"]

CSS = f"""
@page {{ size: {W}pt {H}pt; margin: 0; }}
body {{ margin: 0; font: 17px/1.6 Georgia, 'Times New Roman', serif; color: #1d2430; background: #fbfaf7; }}
header {{ display: flex; gap: 28px; padding: 28px 72px; border-bottom: 1px solid #ddd8cc; }}
header a {{ color: #1d2430; text-decoration: none; font: 15px/1 system-ui, sans-serif; }}
main {{ padding: 48px 72px 72px; max-width: 760px; }}
h1 {{ font-size: 40px; line-height: 1.15; margin: 0 0 24px; font-weight: 600; }}
h2 {{ font-size: 23px; margin: 40px 0 10px; font-weight: 600; }}
li {{ margin: 4px 0; }}
button {{ margin-top: 28px; font: 15px system-ui, sans-serif; padding: 12px 22px; border: 0; border-radius: 6px;
          background: #2f4a3a; color: #fff; }}
footer {{ padding: 24px 72px; font: 13px system-ui, sans-serif; color: #6b7280; border-top: 1px solid #ddd8cc; }}
"""


def page_html(lang, i, key, rows):
    col = LANGS.index(lang)
    links = []
    for p, names in zip(project.PAGES, SRC["nav"]):
        href = "/" + project.CFG["langs"][lang] + (p["slug"] + "/" if p["slug"] else "")
        links.append(f'<a href="{href}">{html.escape(names[col])}</a>')
    body, open_list = [], False
    for tag, *texts in rows:
        t = html.escape(texts[col])
        if tag == "li" and not open_list:
            body.append("<ul>"); open_list = True
        if tag != "li" and open_list:
            body.append("</ul>"); open_list = False
        body.append(f"<{tag}>{t}</{tag}>")
    if open_list:
        body.append("</ul>")
    return (f'<!doctype html>\n<html lang="{lang}"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{html.escape(project.CFG["name"])}</title><style>{CSS}</style></head>\n'
            f'<body><header>{"".join(links)}</header>\n<main>\n' + "\n".join(body) +
            f'\n</main>\n<footer><p>{html.escape(SRC["footer"][col])}</p></footer></body></html>\n')


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    n = 0
    for lang, prefix in project.CFG["langs"].items():
        for i, p in enumerate(project.PAGES):
            d = os.path.join(OUT, prefix, p["slug"])
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
                f.write(page_html(lang, i, p["key"], SRC["pages"][p["key"]]))
            n += 1
    print(f"{n} pages written to sample/site/")


if __name__ == "__main__":
    main()
