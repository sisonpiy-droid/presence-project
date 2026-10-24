"""GET /api/dl?url=PAGE   -> JSON list of downloadable files (yt-dlp, 1000+ sites + generic <video> pages)
   GET /api/dl?get=TOKEN  -> streams that file with a download header (token is HMAC-signed, so this is not an open proxy)"""
import base64, hashlib, hmac, ipaddress, json, os, re, socket, time, urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ponytail: set SIGN_KEY on Vercel; the fallback only exists so local dev runs
KEY = (os.environ.get("SIGN_KEY") or "dev-only-key").encode()


def sign(d):
    b = base64.urlsafe_b64encode(json.dumps(d).encode()).decode()
    return b + "." + hmac.new(KEY, b.encode(), hashlib.sha256).hexdigest()


def unsign(t):
    b, _, mac = t.partition(".")
    if not hmac.compare_digest(mac, hmac.new(KEY, b.encode(), hashlib.sha256).hexdigest()):
        raise ValueError("bad token")
    d = json.loads(base64.urlsafe_b64decode(b))
    if d["e"] < time.time():
        raise ValueError("link expired, fetch it again")
    return d


def check_public(url):
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("enter a full http(s) link")
    for *_, sa in socket.getaddrinfo(p.hostname, None):
        if not ipaddress.ip_address(sa[0]).is_global:
            raise ValueError("that address is not allowed")


def extract(url):
    import yt_dlp
    check_public(url)
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True, "socket_timeout": 15}
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(url, download=False)
    if info.get("entries"):
        info = next(iter(info["entries"]))
    title = re.sub(r'[\/:*?"<>|\r\n]+', "_", info.get("title") or "video")[:80]
    out = []
    for f in info.get("formats") or [info]:
        if not f.get("url") or f.get("protocol") not in ("http", "https"):
            continue  # HLS/DASH fragments can't be proxied statelessly
        v, a = f.get("vcodec") != "none", f.get("acodec") != "none"
        ext = f.get("ext") or "mp4"
        size = f.get("filesize") or f.get("filesize_approx")
        label = ("%sp" % f["height"] if f.get("height") else "video") if v else "audio only"
        if v and not a:
            label += " (no sound)"
        out.append({
            "label": label, "ext": ext, "size": size, "height": f.get("height") or 0, "audio": a, "video": v,
            "token": sign({"u": f["url"], "h": f.get("http_headers") or {}, "n": "%s.%s" % (title, ext), "e": time.time() + 3600}),
        })
    out.sort(key=lambda x: (x["video"] and x["audio"], x["height"], x["size"] or 0), reverse=True)
    return {"title": info.get("title"), "thumbnail": info.get("thumbnail"), "duration": info.get("duration"), "files": out}


class handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        try:
            if "get" in q:
                return self._stream(unsign(q["get"][0]))
            if "url" in q:
                return self._json(200, extract(q["url"][0].strip()))
            self._json(400, {"error": "missing url"})
        except Exception as e:
            msg = re.sub(r"\x1b\[[0-9;]*m|^ERROR:\s*", "", str(e)).strip()
            self._json(400, {"error": msg[:300] or "failed"})

    def _stream(self, d):
        req = urllib.request.Request(d["u"], headers=d["h"])
        with urllib.request.urlopen(req, timeout=20) as r:
            self.send_response(200)
            self.send_header("Content-Type", r.headers.get("Content-Type", "application/octet-stream"))
            if r.headers.get("Content-Length"):
                self.send_header("Content-Length", r.headers["Content-Length"])
            name = d["n"].encode("ascii", "ignore").decode() or "video"
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % name)
            self.end_headers()
            while chunk := r.read(65536):
                self.wfile.write(chunk)
