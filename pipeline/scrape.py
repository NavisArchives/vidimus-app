"""Crawl the site in every language of the project and extract aligned text blocks.

    python pipeline/scrape.py        -> out/scraped.json

The site and its pages come from project.json. A site behind basic auth reads
its credentials from $VIDIMUS_AUTH ("user:password"); none are kept in code.
"""
import base64, json, os, re, urllib.request
from bs4 import BeautifulSoup, Comment, NavigableString
import project

try:
    import lxml  # noqa: F401  (faster, and what the original runs used)
    PARSER = "lxml"
except ImportError:
    PARSER = "html.parser"

BASE = project.CFG["base"].rstrip("/")
PAGES = [(p["key"], p["slug"], p["label"]) for p in project.PAGES]
LANGS = project.CFG["langs"]

# Elements whose text we treat as one reviewable block.
# <option> and <legend> count too: an unprinted dropdown option is still copy
# that needs translating.
BLOCK_TAGS = {"h1","h2","h3","h4","h5","h6","p","li","blockquote",
              "figcaption","summary","dt","dd","label","legend","option",
              "th","td","a","button","span","div"}
SKIP_TAGS = {"script","style","noscript","svg","head"}


def fetch(url):
    req = urllib.request.Request(url)
    auth = os.environ.get("VIDIMUS_AUTH")
    if auth:
        req.add_header("Authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    with urllib.request.urlopen(req) as r:
        return r.read().decode("utf-8")


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def path_sig(el):
    """Structural fingerprint: tag chain from <body>, with sibling index."""
    parts = []
    node = el
    while node is not None and node.name not in (None, "[document]", "html"):
        sibs = [s for s in node.parent.find_all(node.name, recursive=False)] if node.parent else []
        idx = sibs.index(node) if node in sibs else 0
        parts.append(f"{node.name}[{idx}]")
        node = node.parent
    return "/".join(reversed(parts))


def extract(html):
    """Return ordered list of leaf-ish text blocks."""
    soup = BeautifulSoup(html, PARSER)
    for t in soup.find_all(list(SKIP_TAGS)):
        t.decompose()
    body = soup.body or soup
    blocks = []
    def has_texty_block_child(el):
        """A descendant block that actually carries text will be kept in its own
        right, so this element is a wrapper. Purely decorative children (an empty
        <span> used as a bullet dot) must NOT disqualify their parent."""
        return any(norm(d.get_text(" ")) for d in el.find_all(list(BLOCK_TAGS)))

    for el in body.find_all(list(BLOCK_TAGS)):
        if has_texty_block_child(el):
            # A wrapper, but it can still carry text of its own beside those
            # children -- <p><span>Horaires :</span> du mardi au samedi</p>. That
            # text belongs to no child, so take it here or it is simply lost.
            # Comment is a NavigableString subclass, so <!-- Section --> would
            # otherwise be read as page copy. Only real text nodes count.
            own = norm("".join(c for c in el.children
                               if isinstance(c, NavigableString)
                               and not isinstance(c, Comment)))
            # Two characters is enough to be copy: the form label "Nom" beside
            # its "*" was dropped by the old "more than 3" rule.
            if len(own) >= 2:
                blocks.append({"tag": el.name, "sig": path_sig(el), "text": own})
            continue
        txt = norm(el.get_text(" "))
        if not txt:
            continue
        blocks.append({"tag": el.name, "sig": path_sig(el), "text": txt})
    return blocks


def main():
    out = {}
    for key, slug, label in PAGES:
        out[key] = {"label": label, "slug": slug, "langs": {}}
        for lang, prefix in LANGS.items():
            url = f"{BASE}/{prefix}{slug}".rstrip("/") + "/"
            blocks = extract(fetch(url))
            out[key]["langs"][lang] = {"url": url, "blocks": blocks}
            print(f"{key:9s} {lang}  {len(blocks):4d} blocks  {url}")
    project.save_json(out, "scraped.json")
    print("\n--- structural parity ---")
    for key, page in out.items():
        counts = {l: len(v["blocks"]) for l, v in page["langs"].items()}
        same = len(set(counts.values())) == 1
        print(f"{key:9s} {counts}  {'OK' if same else '** MISMATCH **'}")


if __name__ == "__main__":
    main()
