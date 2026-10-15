"""Build a single file copy of the 3D viewer (web/3d.html) for hosts that only accept one HTML page.

The repository keeps the viewer modular (markup, web/3d/style.css, web/3d/*.js, vendored three.js).
This script only inlines those files. Run: python tools/build_artifact_3d.py OUT.html
"""
import base64
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def inline_script(src):
    text = (WEB / src).read_text(encoding="utf-8")
    if "</script" in text.lower():
        raise SystemExit("cannot inline %s: contains a closing script tag" % src)
    return "<script>\n" + text + "\n</script>"


def main(out):
    html = (WEB / "3d.html").read_text(encoding="utf-8")
    css = (WEB / "3d/style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="3d/style.css">', "<style>\n" + css + "</style>")
    for src in re.findall(r'<script src="([^"]+)"></script>', html):
        html = html.replace('<script src="%s"></script>' % src, inline_script(src))
    logo = base64.b64encode((WEB / "assets/rta-logo.png").read_bytes()).decode()
    html = html.replace('src="assets/rta-logo.png"', 'src="data:image/png;base64,' + logo + '"')
    html = re.sub(r"<title>.*?</title>", "<title>Digital Marshal 3D</title>", html, count=1)
    html = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\n', "", html)
    html = html.replace("</head>\n<body>", "").replace("</body>\n</html>", "")
    html = html.replace('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', "")
    html = html.replace('<a class="b" href="index.html" data-i="view2d"></a>', "")
    Path(out).write_text(html, encoding="utf-8")
    print("wrote %s (%d bytes)" % (out, len(html.encode("utf-8"))))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "digital_marshal_3d.single.html")
