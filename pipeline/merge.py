# -*- coding: utf-8 -*-
"""Merge the reviewer's findings with LanguageTool and the external QA into one
list. One card per block; each card carries whichever of the three has
something to say.

    python pipeline/merge.py nl   -> out/findings_nl.json
    python pipeline/merge.py en   -> out/findings_en.json
"""
import collections, json, os, sys
import pages, project

# LanguageTool rules that only add noise on this site (house style, scraper
# artefacts) are listed per language in project.json as ltSkip.
PRIO_SEV = {"P0": "high", "P1": "medium", "P2": "low"}
PRIO_CAT = {"P0": "untranslated", "P1": "register", "P2": "style"}
# LanguageTool is only trusted on the language of a block when it is sure;
# langtool.py already limits detection to blocks of 40+ characters.
DETECT_MIN = 0.9
TYPE = {"misspelling": "spelling", "typographical": "typografie", "grammar": "grammatica",
        "style": "stijl", "whitespace": "spatie", "uncategorized": "overig"}
SEV_RANK = {"low": 0, "medium": 1, "high": 2}


def lt_why(ms, det):
    """What LanguageTool has to say about one block, in one line."""
    groups = collections.OrderedDict()
    for m in ms:
        # the generic "Possible spelling mistake found" adds nothing: the flagged words say it
        key = "" if m["type"] == "misspelling" else m["msg"].rstrip(".")
        groups.setdefault(key, []).append(m["frag"])
    parts = [(f"{msg} ({', '.join('«%s»' % f for f in fr)})" if msg else ", ".join("«%s»" % f for f in fr))
             for msg, fr in groups.items()]
    if det:
        parts.insert(0, f"tekst herkend als {det['code'].upper()} ({det['confidence']:.0%} zeker)")
    return "; ".join(parts)


def lt_fix(txt, ms):
    """The block with LanguageTool's first replacement applied to every match that has one."""
    s = txt
    for m in sorted(ms, key=lambda m: -m["offset"]):
        if m["fix"]:
            s = s[:m["offset"]] + m["fix"][0] + s[m["offset"] + m["len"]:]
    return s if s != txt else ""


def _opt(name):
    return project.load_json(name) if os.path.exists(project.out(name)) else None


def _qa_card(e):
    """The QA report's P0/P1/P2 read as a category and a severity, like the reviewer's."""
    if not e:
        return None
    word = (e["why"].split(". ")[0] if e["why"] else "").rstrip(".")
    return dict(e, category=PRIO_CAT[e["prio"]], severity=PRIO_SEV[e["prio"]], section=e["prio"], short=word)


def main(lang):
    sc = pages.load()
    T = project.TARGETS[lang]
    SKIP = set(T.get("ltSkip", []))
    mine = {f["id"]: f for f in (_opt(f"review_{lang}.json") or [])}
    qa = {e["id"]: _qa_card(e) for e in (_opt(f"qa_{lang}.json") or [])}
    raw = _opt(f"langtool_{lang}.json") or {}
    detected = raw.pop("_detected", {})

    lt = {}
    for page, blocks in raw.items():
        for idx, ms in blocks.items():
            ms = [m for m in ms if m["rule"] not in SKIP]
            if ms:
                lt[f"{page}#{idx}"] = ms
    foreign = {}
    for page, blocks in detected.items():
        for idx, v in blocks.items():
            if v["code"] != lang and v["confidence"] >= DETECT_MIN:
                foreign[f"{page}#{idx}"] = v

    order = {k: n for n, k in enumerate(sc)}
    ids = sorted(set(mine) | set(lt) | set(foreign) | set(qa),
                 key=lambda i: (order[i.split("#")[0]], int(i.split("#")[1])))

    out = []
    for n, bid in enumerate(ids, 1):
        page, idx = bid.split("#"); idx = int(idx)
        m, ms, det, q = mine.get(bid), lt.get(bid, []), foreign.get(bid), qa.get(bid)
        blk_fr = sc[page]["langs"][project.SOURCE]["blocks"][idx]
        blk_en = sc[page]["langs"][lang]["blocks"][idx]

        if m:
            cat, sev = m["category"], m["severity"]
            if q:
                sev = max(sev, q["severity"], key=lambda s: SEV_RANK[s])
        elif q:
            cat, sev = q["category"], q["severity"]
        elif det or any(x["type"] == "misspelling" and not x["fix"] for x in ms):
            cat, sev = "untranslated", "high"      # LT cannot even spell it: not English
        elif any(x["type"] == "misspelling" for x in ms):
            cat, sev = "grammar", "medium"
        else:
            cat, sev = "grammar", "low"

        has_lt = bool(ms or det)
        # LT's first spelling suggestion on a French word is noise ("jam ais",
        # "vers my banque"), so its auto-fix is only offered for non-spelling hits.
        fix = lt_fix(blk_en["text"], ms) if ms and not any(x["type"] == "misspelling" for x in ms) else ""
        default = (m["suggestion"] if m else "") or (q["a"] if q else "") or fix or blk_en["text"]

        # every other reader's proposal, minus the one already in the box and repeats
        seen, others = {default}, []
        def variants(label, txt):
            if not txt or txt in seen:
                return []
            seen.add(txt)
            return [[label, txt]]
        if has_lt:
            others.append({"key": "lt", "name": "LanguageTool",
                           "prio": TYPE.get(ms[0]["type"], ms[0]["type"]) if ms else "taal",
                           # a mechanical fix of the old text would undo the reviewer's wider one
                           "why": lt_why(ms, det), "variants": [] if m else variants("LanguageTool", fix)})
        if q:
            name = T.get("qaName", "QA")
            others.append({"key": "qa", "name": name, "prio": f"QA {q['section']}",
                           "why": q["why"],
                           "variants": variants(f"{name} A", q["a"]) + variants(f"{name} B", q["b"])})

        title = (m["title"] if m else
                 q["why"].split(". ")[0].rstrip(".") if q else
                 ms[0]["msg"].rstrip(".") if ms else "Tekst herkend als een andere taal")
        out.append({
            "n": n, "id": bid, "page": page, "index": idx,
            "tag": blk_en["tag"], "fr": blk_fr["text"], lang: blk_en["text"],
            "category": cat, "severity": sev,
            "sources": [s for s, on in (("claude", bool(m)), ("lt", has_lt), ("qa", bool(q))) if on],
            "title": title,
            "mine": None if not m else {
                "suggestion": m["suggestion"], "note": m["note"],
                "category": m["category"], "lt": [], "pdf": m["pdf"],
            },
            "others": others,
            "filter": "",
            "suggestion": default,
        })

    project.save_json(out, f"findings_{lang}.json")

    print(f"{len(out)} blokken met opmerkingen\n")
    combos = collections.Counter("+".join(f["sources"]) for f in out)
    for k, v in combos.most_common():
        print(f"  {k:18s} {v}")
    print()
    for k, v in collections.Counter(f["category"] for f in out).most_common():
        print(f"  {k:14s} {v}")
    print()
    for k in ("high", "medium", "low"):
        print(f"  {k:14s} {sum(1 for f in out if f['severity']==k)}")
    print()
    for k, v in sorted(collections.Counter(f["page"] for f in out).items(), key=lambda x: order[x[0]]):
        print(f"  {k:10s} {v}")
    for who in ("lt", "qa"):
        only = [f for f in out if f["sources"] == [who]]
        if only:
            print(f"\nalleen {who}:")
            for f in only:
                print(f"  [{f['id']}] {f['title'][:70]}")


if __name__ == "__main__":
    main(project.target(sys.argv))
