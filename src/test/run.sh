#!/bin/bash
# Kullanım: bash run.sh [query]   örn: bash run.sh "iters=100000&only=lamel"
DIR="$(cygpath -m "$(cd "$(dirname "$0")" && pwd)")"
Q="${1:-iters=60000}"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
URL="file:///$DIR/test.html?$Q"
"$CHROME" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --virtual-time-budget=600000 --timeout=600000 --dump-dom "$URL" 2>/dev/null \
  | py -c "
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
