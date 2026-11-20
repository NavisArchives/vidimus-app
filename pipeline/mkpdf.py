"""Print every language of the site to one PDF each, a page per site page, so
the desk can show the source and the translations side by side.

    python pipeline/mkpdf.py      -> out/pdf/<lang>.pdf + out/pdf/starts.json

Uses a Chromium-based browser in headless mode ($VIDIMUS_CHROME, default: Google
Chrome on macOS) with its own throwaway profile. The page size comes from
project.json (the original project matched the client's own PDFs, 960x1358 pt).
A site behind basic auth: mirror it locally first and point "base" at the mirror.
"""
import json, os, subprocess, tempfile
import project

CHROME = os.environ.get("VIDIMUS_CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
BASE = project.CFG["base"].rstrip("/")


def to_pdf(url, dest, profile):
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}",
                    "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
                    "--virtual-time-budget=10000", f"--print-to-pdf={dest}", url],
                   check=True, capture_output=True, timeout=120)


def main():
    from pypdf import PdfReader, PdfWriter
    starts = {}
    with tempfile.TemporaryDirectory() as tmp:
        for lang, prefix in project.CFG["langs"].items():
            w, starts[lang] = PdfWriter(), {}
            for p in project.PAGES:
                url = f"{BASE}/{prefix}{p['slug']}".rstrip("/") + "/"
                part = os.path.join(tmp, f"{lang}_{p['key']}.pdf")
                to_pdf(url, part, os.path.join(tmp, "profile"))
                first = len(w.pages)
                for pg in PdfReader(part).pages:
                    w.add_page(pg)
                w.add_outline_item(p["label"], first)
                starts[lang][p["key"]] = first + 1
            out = project.out("pdf", f"{lang}.pdf")
            with open(out, "wb") as f:
                w.write(f)
            print(f"out/pdf/{lang}.pdf  {len(w.pages)} pages  {os.path.getsize(out)/1024:.0f} KB")
    project.save_json(starts, "pdf", "starts.json")


if __name__ == "__main__":
    main()
