#!/bin/bash
# Double-click to open the review desk on the built sample.
cd "$(dirname "$0")"
PORT=8777
if ! curl -s --max-time 1 "http://localhost:$PORT/out/review-nl.html" >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:$PORT/out/review-nl.html"
echo "Desk open at http://localhost:$PORT/out/review-nl.html (English: review-en.html)"
