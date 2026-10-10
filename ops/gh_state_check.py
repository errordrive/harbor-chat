import sys, json, hashlib, os
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response
import urllib.request, urllib.error

API = "https://api.github.com"
CRED = "custom.github"
HOSTS = ("api.github.com",)

def req(method, path):
    r = urllib.request.Request(API + path, method=method)
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("X-GitHub-Api-Version", "2022-11-28")
    add_surrogate_to_request(r, CRED, allowed_hosts=HOSTS)
    try:
        resp = urllib.request.urlopen(r, timeout=90)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        return {"__error__": f"HTTP {e.code}: {detail}"}
    return read_json_response(resp)

# 1. Get default branch + latest commit
repo = req("GET", "/repos/errordrive/harbor-chat")
if "__error__" in repo:
    print("REPO ERROR:", repo["__error__"]); sys.exit(1)
branch = repo["default_branch"]
print("default_branch:", branch)
ref = req("GET", f"/repos/errordrive/harbor-chat/git/refs/heads/{branch}")
sha = ref["object"]["sha"]
print("head_sha:", sha[:12])

# 2. Get full tree
tree = req("GET", f"/repos/errordrive/harbor-chat/git/trees/{sha}?recursive=1")
if "__error__" in tree:
    print("TREE ERROR:", tree["__error__"]); sys.exit(1)
remote = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
print("remote blob count:", len(remote))

# 3. Compare local git-blob SHAs for key files
local_root = "/home/hatch/workspace/harbor-v32"
targets = ["web/src/components/AuthScreen.jsx", "web/src/components/AdminPanel.jsx",
           "test/otp.test.js", "public/index.html", "public/manifest.json",
           "lib/otp.js", "lib/crypto.js", "lib/gateway.js", "lib/gateway-upstream.js",
           "routes/admin.js", "web/src/App.jsx"]
for t in targets:
    p = os.path.join(local_root, t)
    if not os.path.exists(p):
        print(f"{t}: LOCAL MISSING"); continue
    data = open(p, "rb").read()
    blob = b"blob %d\0" % len(data) + data
    lsha = hashlib.sha1(blob).hexdigest()
    rsha = remote.get(t)
    if rsha is None:
        print(f"{t}: REMOTE MISSING")
    elif rsha == lsha:
        print(f"{t}: MATCH")
    else:
        print(f"{t}: MISMATCH (local {lsha[:8]} vs remote {rsha[:8]})")

# 4. List remote public/ entries
pub = [k for k in remote if k.startswith("public/")]
print("remote public/ count:", len(pub))
for k in sorted(pub)[:20]: print("  ", k)
