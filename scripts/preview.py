from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json,os
root=Path(__file__).resolve().parents[1];os.chdir(root)
routes={r['source']:r['destination'] for r in json.loads(Path('vercel.json').read_text())['rewrites']}
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  path=urlsplit(self.path).path
  if path in routes:self.path=routes[path]
  return super().do_GET()
ThreadingHTTPServer(('0.0.0.0',5501),Handler).serve_forever()
