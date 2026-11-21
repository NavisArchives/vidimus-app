"""Print the invented compliance note to the PDF the lab desks review.

    python lab/sample/make_pdf.py   -> lab/sample/note.pdf

note.html is a designed four-page document about a made-up crypto framework,
from a made-up firm to a made-up regulator, with mistakes put in on purpose
(findings.json lists them). It loads its two fonts from Google Fonts, so the
first run needs a network connection.

Uses a Chromium-based browser in headless mode ($VIDIMUS_CHROME, default: Google
Chrome on macOS) with a throwaway profile, like pipeline/mkpdf.py.
"""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("VIDIMUS_CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PAGES = 4


def main():
    src = os.path.join(HERE, "note.html")
    dest = os.path.join(HERE, "note.pdf")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={tmp}",
                        "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
                        "--virtual-time-budget=15000", f"--print-to-pdf={dest}", "file://" + src],
                       check=True, capture_output=True, timeout=120)
    from pypdf import PdfReader
    n = len(PdfReader(dest).pages)
    print(f"lab/sample/note.pdf  {n} pages  {os.path.getsize(dest)/1024:.0f} KB")
    if n != PAGES:
        sys.exit(f"expected {PAGES} pages, got {n}: a page overflowed, shorten its text")


if __name__ == "__main__":
    main()
