#!/bin/bash
# Run the whole pipeline on the project in project.json (the invented sample by
# default) and build both review pages. Needs: Python 3 with requirements.txt,
# a Chromium-based browser for the PDFs, and a LanguageTool server.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

if [ -f sample/make_site.py ] && [ "${VIDIMUS_PROJECT:-project.json}" = project.json ]; then
  $PY sample/make_site.py
  $PY -m http.server 8899 --bind 127.0.0.1 --directory sample/site >/dev/null 2>&1 &
  SITE=$!; trap 'kill $SITE' EXIT; sleep 1
fi

$PY pipeline/scrape.py          # site, every language     -> out/scraped.json
$PY pipeline/export_txt.py      # TXT / CSV                -> out/export/
$PY pipeline/mkpdf.py           # one PDF per language     -> out/pdf/
for lang in nl en; do
  $PY pipeline/langtool.py $lang   # LanguageTool         -> out/langtool_<lang>.json
  $PY pipeline/qa_import.py $lang  # external QA report   -> out/qa_<lang>.json
  $PY pipeline/findings.py $lang   # reviewer's findings  -> out/review_<lang>.json
  $PY pipeline/merge.py $lang      # one card per block   -> out/findings_<lang>.json
  $PY pipeline/build.py $lang      # the desk             -> out/review-<lang>.html
done
