"""One place for the project settings every script reads.

The project file (project.json by default, or $VIDIMUS_PROJECT) names the site,
its pages, the source language and the languages under review. Every script
writes into out/ and reads its inputs from there or from the paths the
project file gives."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, os.environ.get("VIDIMUS_PROJECT", "project.json")), encoding="utf-8"))
OUT = os.path.join(ROOT, CFG.get("out", "out"))
SOURCE = CFG.get("source", "fr")
TARGETS = CFG["targets"]
PAGES = CFG["pages"]
UI_LABELS = {p["key"]: p.get("ui", p["key"]) for p in PAGES}
LABELS = {p["key"]: p.get("label", p["key"]) for p in PAGES}


def out(*parts):
    p = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def root(*parts):
    return os.path.join(ROOT, *parts)


def load_json(*parts):
    return json.load(open(out(*parts), encoding="utf-8"))


def save_json(obj, *parts):
    with open(out(*parts), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def target(argv):
    """The language under review, from the command line (default: the first target)."""
    lang = argv[1] if len(argv) > 1 else next(iter(TARGETS))
    if lang not in TARGETS:
        raise SystemExit(f"unknown language {lang!r}; the project reviews {', '.join(TARGETS)}")
    return lang
