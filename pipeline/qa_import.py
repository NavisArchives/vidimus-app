# -*- coding: utf-8 -*-
"""Parse an external QA report into structured findings and check every entry
against the real block it claims to describe.

    python pipeline/qa_import.py nl  -> out/qa_nl.json
    python pipeline/qa_import.py en  -> out/qa_en.json

The report (project.json → targets.<lang>.qa) is plain text: one entry per
block, headed [page#index], with a priority (P0/P1/P2), CURRENT, REASON and one
or two proposals. An entry whose quoted CURRENT text does not match its block is
looked up by that text instead (reports are often written against an older
export); one that matches no block, or several, is reported and left out.
"""
import collections, re, sys, unicodedata
import pages, project


def norm(s):
    s = unicodedata.normalize("NFKC", s)
    for a, b in [("’", "'"), ("‘", "'"), ("ʼ", "'"), ("“", '"'),
                 ("”", '"'), ("„", '"'), (" ", " "), (" ", " "), (" ", " ")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def entries(text):
    """Split on the [page#index] headers; rejoin each entry's wrapped lines."""
    parts = re.split(r"\n\[([a-z]+#\d+)\]\n", "\n" + text)
    for i in range(1, len(parts), 2):
        yield parts[i], norm(parts[i + 1])


def field(body, start, *stops):
    m = re.search(start, body)
    if not m:
        return ""
    rest = body[m.end():]
    cut = len(rest)
    for s in stops:
        n = re.search(s, rest)
        if n:
            cut = min(cut, n.start())
    return rest[:cut].strip()


def main(lang):
    sc = pages.load()
    text = open(project.root(project.TARGETS[lang]["qa"]), encoding="utf-8").read()

    P_A = r"PROPOSAL A\s*(\([^)]*\))?\s*:"
    P_B = r"PROPOSAL B\s*(\([^)]*\))?\s*:"
    out, bad = [], []

    for bid, body in entries(text):
        page, idx = bid.split("#"); idx = int(idx)
        blocks = sc.get(page, {}).get("langs", {})
        if not blocks or idx >= len(blocks[lang]["blocks"]):
            bad.append((bid, "no such block")); continue

        prio = (re.search(r"\b(P[012])\b", body) or [None, "P2"])[1]
        cur = field(body, r"CURRENT:", r"REASON:", P_A, P_B)
        why = field(body, r"REASON:", P_A, P_B)
        a = field(body, P_A, P_B)
        b = field(body, P_B)

        real = blocks[lang]["blocks"][idx]["text"]
        if norm(cur).rstrip(".") != norm(real).rstrip("."):
            # The report quotes an index from an older export. Trust its quoted
            # text over its index and find the block that actually carries it.
            want = norm(cur).rstrip(".")
            found = [j for j, blk in enumerate(blocks[lang]["blocks"])
                     if norm(blk["text"]).rstrip(".") == want]
            if len(found) != 1:
                bad.append((bid, "CURRENT matches no block (or more than one)"))
                continue
            idx = found[0]
            bid = f"{page}#{idx}"
        if not (a or b):
            bad.append((bid, "no proposal")); continue

        out.append({"id": bid, "page": page, "index": idx, "prio": prio,
                    "why": why, "a": a, "b": b})

    project.save_json(out, f"qa_{lang}.json")
    print(f"{len(out)} of {len(out) + len(bad)} items taken")
    for k, v in sorted(collections.Counter(e["prio"] for e in out).items()):
        print(f"  {k}: {v}")
    print(f"  with both proposals: {sum(1 for e in out if e['a'] and e['b'])}")
    if bad:
        print(f"\n{len(bad)} NOT taken:")
        for bid, why in bad:
            print(f"  {bid:16s} {why}")


if __name__ == "__main__":
    main(project.target(sys.argv))
