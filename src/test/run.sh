#!/bin/bash
# Kullanım: bash run.sh [query]   örn: bash run.sh "iters=100000&only=lamel"
# Windows (Git Bash), Linux ve macOS'ta çalışır.
set -u
Q="${1:-iters=60000}"

DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v cygpath >/dev/null 2>&1; then DIR="$(cygpath -m "$DIR")"; fi

# Tarayıcıyı bul: ortam değişkeni > yaygın konumlar
find_chrome() {
  [ -n "${CHROME:-}" ] && { echo "$CHROME"; return; }
  for c in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/opt/pw-browsers/chromium-"*/chrome-linux/chrome \
    ; do [ -x "$c" ] && { echo "$c"; return; }; done
  for c in google-chrome chromium chromium-browser msedge; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return; }
  done
}
CHROME="$(find_chrome)"
[ -z "$CHROME" ] && { echo "Chrome/Chromium bulunamadı. CHROME=/yol/chrome bash run.sh" >&2; exit 1; }

# Python'u bul (Windows'ta 'py', diğerlerinde 'python3')
PY=""
for p in python3 py python; do command -v "$p" >/dev/null 2>&1 && { PY="$p"; break; }; done
[ -z "$PY" ] && { echo "Python bulunamadı." >&2; exit 1; }

"$CHROME" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --disable-background-networking --disable-component-update --no-first-run \
  --virtual-time-budget=600000 --timeout=600000 --dump-dom "file:///$DIR/test.html?$Q" 2>/dev/null \
  | "$PY" -c "
import sys, re, html
s = sys.stdin.read()
m = re.search(r'<pre id=\"out\">(.*?)</pre>', s, re.S)
print(html.unescape(m.group(1)) if m else s[:3000])
x = re.search(r'<pre id=\"xlsx\">(.*?)</pre>', s, re.S)
if x and x.group(1).strip():
    import base64
    open('test-output.xlsx', 'wb').write(base64.b64decode(x.group(1).strip()))
    print('test-output.xlsx yazıldı')
"
