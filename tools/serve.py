"""Serve site/ locally: python3 tools/serve.py [port]"""
import functools, http.server, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1] / "site"
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
http.server.ThreadingHTTPServer(("127.0.0.1", port), h).serve_forever()
