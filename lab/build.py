"""Build the lab desks: one self-contained page per design direction.

    python lab/build.py          -> lab/v1/index.html, lab/v2/index.html

Each direction is a template (lab/vN/template.html) with its own layout and
styles. The logic they share (lab/desk.js) and the sample data
(lab/sample/findings.json) are inlined, so every page opens from any local web
server with no build step of its own, like the desk in out/.

Before anything is written, every finding is checked against the PDF it is
about: its quote must appear exactly once on its page, and its suggestion must
differ from it. A finding that cannot be found is a finding that would be drawn
in the wrong place, so the build stops instead.
"""
import json, os, re, sys, unicodedata

LAB = os.path.dirname(os.path.abspath(__file__))
DIRECTIONS = ["v1"]   # v2 « Ledger » was retired once Andy picked « Paper » (21 Nov); it is in git history
SEVERITIES = {"high", "medium", "low"}
TYPES = {"figures", "reference", "terminology", "consistency", "language"}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def fold(s):
    """The comparison the desk itself makes: no whitespace, typographic quotes
    straightened, case folded."""
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[’‘ʼ]", "'", s)
    s = re.sub(r"[“”„]", '"', s)
    return re.sub(r"\s+", "", s).lower()


def page_texts(pdf):
    from pypdf import PdfReader
    return [fold(p.extract_text() or "") for p in PdfReader(pdf).pages]


def check(data, texts):
    """Return a list of problems; empty means the sample is sound."""
    problems = []
    agents = {a["key"] for a in data["agents"]}
    seen_ids, seen_quotes = set(), set()
    for f in data["findings"]:
        fid = f.get("id", "?")
        if fid in seen_ids:
            problems.append(f"{fid}: duplicate id")
        seen_ids.add(fid)
        if f["severity"] not in SEVERITIES:
            problems.append(f"{fid}: unknown severity {f['severity']!r}")
        if f["type"] not in TYPES:
            problems.append(f"{fid}: unknown type {f['type']!r}")
        if not f.get("agents") or set(f["agents"]) - agents:
            problems.append(f"{fid}: agents must be a non-empty subset of {sorted(agents)}")
        for v in f.get("variants", []):
            if v["agent"] not in f["agents"]:
                problems.append(f"{fid}: variant by {v['agent']!r}, who did not flag it")
        if fold(f["suggestion"]) == fold(f["quote"]):
            problems.append(f"{fid}: suggestion equals the quote")
        key = (f["page"], fold(f["quote"]))
        if key in seen_quotes:
            problems.append(f"{fid}: a second finding on the same quote")
        seen_quotes.add(key)
        n = f["page"]
        if not 1 <= n <= len(texts):
            problems.append(f"{fid}: page {n} outside the PDF (1-{len(texts)})")
            continue
        hits = texts[n - 1].count(fold(f["quote"]))
        if hits != 1:
            problems.append(f"{fid}: quote found {hits}x on page {n}, expected once: {f['quote']!r}")
    team = {u["key"] for u in data.get("team", [])}
    for d in data.get("decisions", []):
        if d["finding"] not in seen_ids or d["by"] not in team or d["verdict"] not in {"approved", "rejected"}:
            problems.append(f"decision {d}: unknown finding, person or verdict")
    return problems


def sprite():
    """Every SVG in lab/assets/icons and lab/assets/logos as one hidden sprite of
    <symbol>s: icons as #i-<name>, logos as #logo-<name>. Ids inside a file (a
    logo's gradient) are prefixed so they stay unique in the page. The sprite is
    sized to zero rather than display:none, which would also hide gradients."""
    out = []
    for kind, prefix in (("icons", "i-"), ("logos", "logo-")):
        folder = os.path.join(LAB, "assets", kind)
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".svg"):
                continue
            svg = read(os.path.join(folder, name))
            tag = re.search(r"<svg\b[^>]*>", svg).group(0)
            box = re.search(r'viewBox="([^"]+)"', tag).group(1)
            keep = "".join(f' {a}="{v}"' for a, v in re.findall(r'\s(fill|fill-rule)="([^"]+)"', tag))
            inner = svg[svg.index(tag) + len(tag):svg.rindex("</svg>")]
            inner = re.sub(r"<title>.*?</title>", "", inner, flags=re.S)
            sid = prefix + name[:-4]
            inner = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{sid}-{m.group(1)}"', inner)
            inner = re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{sid}-{m.group(1)})", inner)
            out.append(f'<symbol id="{sid}" viewBox="{box}"{keep}>{inner.strip()}</symbol>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" '
            'style="position:absolute;width:0;height:0;overflow:hidden">' + "".join(out) + "</svg>")


def main():
    data = json.loads(read(os.path.join(LAB, "sample", "findings.json")))
    pdf = os.path.join(LAB, "sample", data["document"]["file"])
    problems = check(data, page_texts(pdf))
    if problems:
        sys.exit("lab/sample/findings.json does not match the PDF:\n  " + "\n  ".join(problems))

    data.pop("about", None)
    data["document"]["file"] = "../sample/" + data["document"]["file"]
    data["vendor"] = "../../desk/vendor/"
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    script = read(os.path.join(LAB, "desk.js"))
    icons = sprite()
    for d in DIRECTIONS:
        src = os.path.join(LAB, d, "template.html")
        if not os.path.exists(src):
            continue
        tpl = read(src)
        html = tpl.replace("<!--__SPRITE__-->", icons).replace("__DATA__", blob).replace("/*__DESK__*/", script)
        out = os.path.join(LAB, d, "index.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"lab/{d}/index.html  {len(html)/1024:.0f} KB  {len(data['findings'])} findings")


if __name__ == "__main__":
    main()
