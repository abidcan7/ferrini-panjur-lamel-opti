# -*- coding: utf-8 -*-
"""src/index.html içindeki data-inline script'leri gömerek tek dosyalık ../PanjurKesim.html üretir.
Kullanım:  py build.py
"""
import re, os, io, datetime

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(SRC), 'PanjurKesim.html')
html = io.open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()

PATTERN = re.compile(r'<script src="([^"]+)" data-inline([^>]*)></script>')


def inline(m):
    src, attrs = m.group(1), m.group(2)
    ident = re.search(r'id="([^"]+)"', attrs)
    code = io.open(os.path.join(SRC, src), encoding='utf-8').read()
    code = code.replace('</script', '<\\/script')  # gömülü kodda kapanış etiketi olmasın
    id_attr = ' id="%s"' % ident.group(1) if ident else ''
    return '<script%s>\n%s\n</script>' % (id_attr, code)


out = PATTERN.sub(inline, html)
stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
out = out.replace('<title>Panjur Kesim Optimizasyonu</title>', '<title>Panjur Kesim Optimizasyonu</title>\n<!-- build %s -->' % stamp)
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
print('yazıldı:', OUT, '%.1f KB' % (os.path.getsize(OUT) / 1024))
