"""GET /api/dl?url=PAGE   -> JSON list of downloadable files (yt-dlp, 1000+ sites + generic <video> pages)
   GET /api/dl?get=TOKEN  -> streams that file with a download header (token is HMAC-signed, so this is not an open proxy)"""
import base64, hashlib, hmac, ipaddress, json, os, re, socket, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
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


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MEDIA = re.compile(r"""https?://[^\s"'<>\\]+?\.(?:m3u8|mp4|webm|mov)(?:\?[^\s"'<>\\]*)?""", re.I)


def fetch(url, referer=None, limit=2_000_000):
    h = {"User-Agent": UA}
    if referer:
        h["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15) as r:
        return r.read(limit).decode("utf-8", "ignore")


def sniff(url):
    """Fallback for ad-heavy/embedded players: scan the page, then its iframes, for media URLs in the raw HTML/JS."""
    found, seen = [], set()
    def scan(u, depth):
        if u in seen or len(seen) > 6:
            return
        seen.add(u)
        try:
            check_public(u)
            html = fetch(u, referer=url)
        except Exception:
            return
        for m in MEDIA.findall(html.replace("\\/", "/")):
            if m not in found:
                found.append(m)
        if depth < 2:
            for src in re.findall(r"""<iframe[^>]+src=["']([^"']+)""", html, re.I):
                scan(urljoin(u, src), depth + 1)
    scan(url, 0)
    return [{"url": m, "ext": "m3u8" if ".m3u8" in m else m.split("?")[0].rsplit(".", 1)[-1].lower(),
             "http_headers": {"User-Agent": UA, "Referer": url}} for m in found]


def hls_segments(url, headers):
    """Yield segment URLs of a media playlist (picks the best variant of a master). Encrypted streams are refused."""
    txt = fetch_h(url, headers)
    if "#EXT-X-STREAM-INF" in txt:
        best, bw = None, -1
        lines = txt.splitlines()
        for i, l in enumerate(lines):
            m = re.search(r"BANDWIDTH=(\d+)", l)
            if l.startswith("#EXT-X-STREAM-INF") and m and int(m[1]) > bw:
                bw, best = int(m[1]), urljoin(url, next(x for x in lines[i + 1:] if x and not x.startswith("#")))
        return hls_segments(best, headers)
    if re.search(r"#EXT-X-KEY:METHOD=(?!NONE)", txt):
        raise ValueError("this stream is encrypted, can't download it")
    init = re.search(r'#EXT-X-MAP:URI="([^"]+)"', txt)
    segs = [urljoin(url, l) for l in txt.splitlines() if l and not l.startswith("#")]
    return ([urljoin(url, init[1])] if init else []) + segs


def fetch_h(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
        return r.read(5_000_000).decode("utf-8", "ignore")


def fetch_bytes(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return r.read()


def extract(url):
    import yt_dlp
    check_public(url)
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True, "socket_timeout": 15}
    info = {}
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=False)
        if info.get("entries"):
            info = next(iter(info["entries"]))
    except Exception as e:
        err = e
    fmts = [f for f in (info.get("formats") or ([info] if info.get("url") else [])) if f.get("url")]
    if not any(f.get("protocol") in ("http", "https", "m3u8", "m3u8_native") for f in fmts):
        fmts = sniff(url) or fmts
        if not fmts:
            raise err if not info else ValueError("no video found on that page")
    title = re.sub(r'[\\/:*?"<>|\r\n]+', "_", info.get("title") or urlparse(url).hostname or "video")[:80]
    out = []
    for f in fmts:
        hls = f.get("protocol") in ("m3u8", "m3u8_native") or ".m3u8" in f["url"].split("?")[0]
        if not hls and f.get("protocol") not in (None, "http", "https"):
            continue  # DASH can't be stitched without ffmpeg
        v, a = f.get("vcodec") != "none", f.get("acodec") != "none"
        ext = "ts" if hls else (f.get("ext") or "mp4")
        size = f.get("filesize") or f.get("filesize_approx")
        label = ("%sp" % f["height"] if f.get("height") else "video") if v else "audio only"
        if v and not a:
            label += " (no sound)"
        out.append({
            "label": label + (" (stream)" if hls else ""), "ext": ext, "direct": None if hls else f["url"], "size": size, "height": f.get("height") or 0, "audio": a, "video": v,
            "token": sign({"u": f["url"], "h": f.get("http_headers") or {}, "n": "%s.%s" % (title, ext), "e": time.time() + 3600, "k": "hls" if hls else "file"}),
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

    def _hls(self, d):
        segs = hls_segments(d["u"], d["h"])
        self.send_response(200)
        self.send_header("Content-Type", "video/mp2t")
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % (d["n"].encode("ascii", "ignore").decode() or "video.ts"))
        self.end_headers()
        with ThreadPoolExecutor(6) as ex:
            pend = [ex.submit(fetch_bytes, u, d["h"]) for u in segs[:6]]
            nxt = 6
            while pend:
                data = pend.pop(0).result()
                self.wfile.write(data)
                if nxt < len(segs):
                    pend.append(ex.submit(fetch_bytes, segs[nxt], d["h"]))
                    nxt += 1

    def _stream(self, d):
        if d.get("k") == "hls":
            return self._hls(d)
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
