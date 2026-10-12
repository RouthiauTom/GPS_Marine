"""Static test server, also mounting the app at /marine/ to exercise relative URLs."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent

class Handler(SimpleHTTPRequestHandler):
    release_override = None

    def do_POST(self):
        if self.path != '/__test/release':
            self.send_error(404)
            return
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Handler.release_override = data.get('release')
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == '/sw.js' and Handler.release_override:
            script = (ROOT / 'sw.js').read_text()
            script = re.sub(r"const RELEASE = '[^']+'", f"const RELEASE = {json.dumps(Handler.release_override)}", script)
            payload = script.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        if path.startswith('/marine/'):
            path = path[len('/marine'):]
        return super().translate_path(path)

ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
