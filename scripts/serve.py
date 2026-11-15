#!/usr/bin/env python3
"""Local dev server: serves public/ and falls back to index.html for app routes (like the hosts do)."""
import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and not self.path.startswith("/data/"):
            self.path = "/index.html"
        return super().send_head()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
