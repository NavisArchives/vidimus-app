"""Run a LanguageTool server over every block of the language under review and
save the raw matches, plus which language LanguageTool itself thinks each block
is in.

    python pipeline/langtool.py nl   -> out/langtool_nl.json
    python pipeline/langtool.py en   -> out/langtool_en.json

The server is local by default (languagetool-server --port 8081), so no text
leaves the machine. $LT_SERVER points elsewhere; $LT_DELAY (seconds) spaces the
calls for a rate-limited server.
"""
import json, os, sys, time, urllib.parse, urllib.request
import pages, project

SRV = os.environ.get("LT_SERVER", "http://localhost:8081/v2/check")
DELAY = float(os.environ.get("LT_DELAY", "0"))
# Project vocabulary LanguageTool cannot know about -> suppress spelling noise.
KNOWN = set(project.CFG.get("known", []))


def call(text, language):
    if DELAY:
        time.sleep(DELAY)
    data = urllib.parse.urlencode({"text": text, "language": language, "level": "picky"}).encode()
    with urllib.request.urlopen(urllib.request.Request(SRV, data=data), timeout=120) as r:
        return json.load(r)


def main(lang):
    d = pages.load()
    seen, out, detected = {}, {}, {}
    total = flagged = foreign = 0
    for key, page in d.items():
        out[key], detected[key] = {}, {}
        for i, blk in enumerate(page["langs"][lang]["blocks"]):
            txt = blk["text"]
            if len(txt) < 4 or blk.get("meta"):
                continue
            total += 1
            if txt not in seen:
                res = call(txt, project.TARGETS[lang]["variant"])
                # a second pass with language=auto: what does LT think this is?
                # Without fastText its detector guesses wildly on short labels
                # ("Legal notice" comes back as Italian), so 40+ chars only.
                det = call(txt, "auto")["language"]["detectedLanguage"] if len(txt) >= 40 else None
                seen[txt] = (res["matches"], det)
            matches, det = seen[txt]
            ms = []
            for m in matches:
                frag = txt[m["offset"]:m["offset"] + m["length"]]
                # drop spelling hits on known project vocabulary
                if m["rule"]["issueType"] in ("misspelling", "typographical") and frag.strip("’'.,") in KNOWN:
                    continue
                ms.append({
                    "msg": m["message"],
                    "frag": frag,
                    "offset": m["offset"],
                    "len": m["length"],
                    "rule": m["rule"]["id"],
                    "cat": m["rule"]["category"]["name"],
                    "type": m["rule"]["issueType"],
                    "fix": [r["value"] for r in m["replacements"][:3]],
                })
            if ms:
                out[key][str(i)] = ms
                flagged += 1
            if det:
                code = det["code"].split("-")[0]
                detected[key][str(i)] = {"code": code, "confidence": round(det.get("confidence", 0), 2)}
                if code != lang:
                    foreign += 1
    out["_detected"] = detected
    project.save_json(out, f"langtool_{lang}.json")
    print(f"checked {total} blocks ({len(seen)} unique), {flagged} carry at least one match, "
          f"{foreign} detected as another language than {lang}")
    for key in d:
        print(f"  {key:9s} {len(out[key]):3d} blocks flagged")
    if foreign:
        print("\ndetected as another language:")
        for key in d:
            for i, v in detected[key].items():
                if v["code"] != lang:
                    t = d[key]["langs"][lang]["blocks"][int(i)]["text"]
                    print(f"  [{key}#{i}] {v['code']} {v['confidence']:.2f}  {t[:70]}")


if __name__ == "__main__":
    main(project.target(sys.argv))
