"""Tiny Meshy REST helper. Reads MESHY_API_KEY from the environment or ~/.hermes/.env (never stored in the repo)."""
import json, os, sys, urllib.request, pathlib

def key():
    k = os.environ.get("MESHY_API_KEY")
    if not k:
        for line in pathlib.Path.home().joinpath(".hermes/.env").read_text().splitlines():
            if line.startswith("MESHY_API_KEY="):
                k = line.split("=", 1)[1].strip().strip('"')
    return k

def call(method, path, body=None):
    req = urllib.request.Request("https://api.meshy.ai" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")

if __name__ == "__main__":
    m, p = sys.argv[1], sys.argv[2]
    b = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    print(json.dumps(call(m, p, b), indent=1))
