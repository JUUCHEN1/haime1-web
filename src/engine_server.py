#!/usr/bin/env python3
"""
hanime-engine-server.py — HTTP 常驻引擎桥
替代原 hanime-engine.py (子进程模式)，改为 HTTP 服务常驻
减少每次请求的 Python 启动开销

运行: python3 engine_server.py [port]
默认端口: 5001
"""
import json
import os
import re
import sys
import time
import warnings
from html import unescape
from urllib.parse import urljoin
from http.server import HTTPServer, BaseHTTPRequestHandler

import cloudscraper

warnings.filterwarnings("ignore")

MAX_RETRIES = 3
RETRY_DELAY = 1
BASE_URL = "https://hanime1.me"


def _get_proxy():
    """Read proxy from config file (set by web UI settings page)."""
    config_path = os.environ.get("PROXY_CONFIG_PATH", "/app/data/proxy-config.json")
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        return cfg.get("socks5") or cfg.get("http") or ""
    except:
        pass
    # Fallback to env vars (Docker)
    for key in ("ENGINE_PROXY_SOCKS5", "ENGINE_PROXY_HTTP", "ENGINE_PROXY"):
        val = os.environ.get(key, "").strip()
        if val:
            return val
    return ""

def create_scraper():
    s = cloudscraper.create_scraper()
    s.headers.update({
        "Referer": f"{BASE_URL}/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    })
    proxy = _get_proxy()
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
        print(f"[engine] using proxy: {proxy}", file=sys.stderr, flush=True)
    else:
        print(f"[engine] direct connection (no proxy)", file=sys.stderr, flush=True)
    return s


def clean_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', '_', strip_html(name)).strip()[:200]


def strip_html(value: str) -> str:
    return unescape(re.sub(r'<[^>]+>', '', value or '').replace('&nbsp;', ' ')).strip()


def normalize_url(url: str) -> str:
    if not url:
        return ""
    return urljoin(BASE_URL, unescape(url).strip())


def fetch_page(scraper, url: str, label: str, timeout=20, min_len=200):
    last = None
    for i in range(MAX_RETRIES):
        try:
            r = scraper.get(url, timeout=timeout)
            last = r
            body_len = len(getattr(r, "text", "") or "")
            print(f"[engine] {label} attempt {i+1}: HTTP {r.status_code} len={body_len}", file=sys.stderr, flush=True)
            if r.status_code == 200 and body_len >= min_len:
                return r
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", RETRY_DELAY))
            else:
                wait = RETRY_DELAY * (2 ** i)
            if i < MAX_RETRIES - 1:
                time.sleep(wait)
        except Exception as e:
            print(f"[engine] {label} attempt {i+1}: {e}", file=sys.stderr, flush=True)
            if i < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (2 ** i))
    return last


def quality_key(q: str) -> int:
    m = re.search(r'(\d+)', q or "")
    return int(m.group(1)) if m else 0


def extract_cover_url(html: str) -> str:
    patterns = [
        r'<img[^>]*class="[^"]*download-image[^"]*"[^>]*(?:src|data-src|data-original)="([^"]+)"',
        r'<img[^>]*(?:src|data-src|data-original)="([^"]+)"[^>]*class="[^"]*download-image[^"]*"',
        r'<meta[^>]*(?:property|name)="og:image"[^>]*content="([^"]+)"',
        r'<meta[^>]*content="([^"]+)"[^>]*(?:property|name)="og:image"',
        r'<meta[^>]*(?:property|name)="twitter:image"[^>]*content="([^"]+)"',
        r'<link[^>]*rel="image_src"[^>]*href="([^"]+)"',
    ]
    for pattern in patterns:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if m:
            return normalize_url(m.group(1))
    # Last resort: pick the first plausible image URL from page HTML.
    imgs = re.findall(r'(?:src|data-src|data-original)="([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"', html, re.IGNORECASE)
    for img in imgs:
        if any(x in img.lower() for x in ("avatar", "logo", "icon")):
            continue
        return normalize_url(img)
    return ""


def extract_video_details(html: str) -> tuple[list[str], str]:
    raw_tags = re.findall(r'<a[^>]*href=["\'][^"\']*tag[^"\']*["\'][^>]*>(.*?)</a>', html, re.IGNORECASE | re.DOTALL)
    if not raw_tags:
        raw_tags = re.findall(r'<a[^>]*class=["\'][^"\']*(?:badge|tag)[^"\']*["\'][^>]*>(.*?)</a>', html, re.IGNORECASE | re.DOTALL)
    tags = []
    seen = set()
    for raw in raw_tags:
        tag = strip_html(raw)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
        if len(tags) >= 12:
            break

    desc = ""
    desc_patterns = [
        r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']*)',
        r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']*)',
        r'<meta[^>]*content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\'](?:description|og:description)["\']',
        r'<div[^>]*class=["\'][^"\']*(?:description|video-description|watch-description)[^"\']*["\'][^>]*>(.*?)</div>',
    ]
    for pattern in desc_patterns:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if m:
            desc = strip_html(m.group(1))[:800]
            if desc:
                break
    return tags, desc


def extract_author_profile(html: str, user_id: str) -> dict:
    name = ""
    for pattern in [
        r'<h3[^>]*>(.*?)</h3>',
        r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']*)',
        r'<title>(.*?)</title>',
    ]:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if m:
            name = strip_html(m.group(1))
            break
    if not name or name == f"User {user_id}":
        name = f"User {user_id}"
    name = re.sub(r'\s*[-|].*$', '', name).strip() or f"User {user_id}"

    avatar = ""
    avatar_patterns = [
        r'<img[^>]*class=["\'][^"\']*(?:avatar|user|profile)[^"\']*["\'][^>]*(?:src|data-src)="([^"\']+)"',
        r'<img[^>]*(?:src|data-src)="([^"\']+)"[^>]*class=["\'][^"\']*(?:avatar|user|profile)[^"\']*["\']',
        r'<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']*)',
    ]
    for pattern in avatar_patterns:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if m:
            avatar = normalize_url(m.group(1))
            break
    return {"user_id": user_id, "name": name, "avatar": avatar}


def action_user_profile(scraper, user_id: str):
    for url, label in [
        (f"{BASE_URL}/user/{user_id}", f"user_profile {user_id}"),
        (f"{BASE_URL}/user/{user_id}/playlists", f"user_profile_playlists {user_id}"),
        (f"{BASE_URL}/user/{user_id}/uploaded", f"user_profile_uploaded {user_id}"),
    ]:
        r = fetch_page(scraper, url, label, timeout=15, min_len=100)
        if r and r.status_code == 200:
            profile = extract_author_profile(r.text, user_id)
            if profile.get("name") or profile.get("avatar"):
                return profile
    return {"user_id": user_id, "name": f"User {user_id}", "avatar": ""}


def cover_candidates(scraper, video_id: str, info=None) -> list[str]:
    candidates = []
    if info and info.get("cover_url"):
        candidates.append(normalize_url(info["cover_url"]))
    for url, label in [
        (f"{BASE_URL}/watch?v={video_id}", f"cover_watch {video_id}"),
        (f"{BASE_URL}/download?v={video_id}", f"cover_download {video_id}"),
    ]:
        r = fetch_page(scraper, url, label, timeout=15, min_len=200)
        if r and r.status_code == 200:
            cover = extract_cover_url(r.text)
            if cover:
                candidates.append(cover)
    out = []
    seen = set()
    for item in candidates:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def extract_video_ids(html: str) -> list[str]:
    ids = set()
    # Pattern 1: data-href with watch?v=ID
    marker = 'data-href="'
    pos = 0
    while True:
        pos = html.find(marker, pos)
        if pos == -1:
            break
        end = html.find('"', pos + len(marker))
        if end == -1:
            break
        val = html[pos + len(marker):end]
        m = re.search(r'watch\?v=(\d+)', val)
        if m:
            ids.add(m.group(1))
        pos = end + 1
    # Pattern 2: href with watch?v=ID
    if not ids:
        ids.update(re.findall(r'href=["\'][^"\']*watch\?v=(\d+)', html))
    # Pattern 3: Any occurrence of /watch?v=ID in href or onclick
    if not ids:
        ids.update(re.findall(r'watch\?v=(\d+)', html))
    # Pattern 4: data-id or data-video attributes
    if not ids:
        ids.update(re.findall(r'data-(?:id|video)[= ]*["\']?(\d+)', html))
    return sorted(ids)


def action_user_playlists(scraper, user_id: str):
    url = f"{BASE_URL}/user/{user_id}/playlists"
    r = fetch_page(scraper, url, f"user_playlists {user_id}")
    if not r or r.status_code != 200:
        status = getattr(r, "status_code", "no response")
        return {"error": f"HTTP {status}", "playlists": []}
    playlist_ids = sorted(set(re.findall(r'href=["\'][^"\']*playlist\?list=(\d+)', r.text)))
    titles = re.findall(r'<div[^>]*title="([^"]*)"', r.text)
    playlists = []
    for i, pid in enumerate(playlist_ids):
        title = titles[i] if i < len(titles) else f"playlist_{pid}"
        playlists.append({"id": pid, "title": title, "safe_title": clean_name(title)})
    return {"playlists": playlists, "total": len(playlists)}


def action_playlist_videos(scraper, playlist_id: str):
    url = f"{BASE_URL}/playlist?list={playlist_id}"
    for i in range(MAX_RETRIES):
        r = fetch_page(scraper, url, f"playlist_videos {playlist_id}", timeout=20, min_len=100)
        if r and r.status_code == 200:
            ids = extract_video_ids(r.text)
            print(f"[engine] playlist_videos {playlist_id}: extracted {len(ids)} video IDs", file=sys.stderr, flush=True)
            if not ids and len(r.text) < 30000 and i < MAX_RETRIES - 1:
                time.sleep(1 * (2**i))  # exponential backoff: 1s, 2s, 4s
                continue
            if not ids:
                # Debug: check what patterns exist in the HTML
                sample = r.text[-2000:] if len(r.text) > 2000 else r.text
                hrefs = re.findall(r'href="([^"]+)"', sample)[:10]
                print(f"[engine] playlist_videos {playlist_id}: no IDs found, sample hrefs: {hrefs}", file=sys.stderr, flush=True)
            return {"playlist_id": playlist_id, "videos": ids, "count": len(ids)}
        elif (not r or r.status_code != 200) and i < MAX_RETRIES - 1:
            time.sleep(1 * (2**i))
    return {"playlist_id": playlist_id, "videos": [], "count": 0, "error": "failed after retries"}


def action_video_info(scraper, video_id: str):
    url = f"{BASE_URL}/download?v={video_id}"
    r = fetch_page(scraper, url, f"video_info {video_id}")
    if r and r.status_code == 200:
        title_match = re.search(r'<h3[^>]*>(.*?)</h3>', r.text, re.DOTALL)
        if not title_match:
            title_match = re.search(r'<title>(.*?)</title>', r.text, re.DOTALL)
        title = strip_html(title_match.group(1)) if title_match else f"video_{video_id}"
        cover_url = extract_cover_url(r.text)
        if not cover_url:
            try:
                wr = fetch_page(scraper, f"{BASE_URL}/watch?v={video_id}", f"video_cover_watch {video_id}", timeout=15, min_len=200)
                if wr and wr.status_code == 200:
                    cover_url = extract_cover_url(wr.text)
            except Exception:
                pass
        links = re.findall(r'<a[^>]*data-url="([^"]+)"[^>]*>(.*?)</a>', r.text, re.DOTALL)
        videos = {}
        for data_url, link_html in links:
            data_url = unescape(data_url)
            q_match = re.search(r'-(\d+p)\.', data_url)
            quality = q_match.group(1) if q_match else "unknown"
            videos[quality] = data_url
        if not videos:
            hrefs = re.findall(r'<a[^>]*href="(https://[^"]+\.(?:mp4|m3u8)[^"]*)"[^>]*>', r.text)
            for j, du in enumerate(sorted(set(hrefs))):
                du = unescape(du)
                q_match = re.search(r'-(\d+p)\.', du)
                quality = q_match.group(1) if q_match else f"link_{j}"
                videos[quality] = du
        return {
            "video_id": video_id, "title": title, "safe_title": clean_name(title),
            "cover_url": cover_url, "videos": videos,
            "qualities": sorted(videos.keys(), key=quality_key, reverse=True),
        }
    return {"error": "failed to fetch", "video_id": video_id}


def action_user_uploaded(scraper, user_id: str, page=1):
    fetch_all = (page == 0 or str(page) in ("0", "all"))
    page_num = 1 if fetch_all else int(page)
    if fetch_all:
        all_ids = set()
        while True:
            url = f"{BASE_URL}/user/{user_id}/uploaded"
            if page_num > 1:
                url += f"?page={page_num}"
            r = fetch_page(scraper, url, f"user_uploaded {user_id} page {page_num}")
            if not r or r.status_code != 200:
                break
            ids = set(extract_video_ids(r.text))
            if not ids:
                break
            all_ids.update(ids)
            page_num += 1
            time.sleep(1.5)
        return {"user_id": user_id, "videos": sorted(all_ids), "count": len(all_ids), "pages": page_num - 1}
    else:
        url = f"{BASE_URL}/user/{user_id}/uploaded"
        if page_num > 1:
            url += f"?page={page_num}"
        r = fetch_page(scraper, url, f"user_uploaded {user_id} page {page_num}")
        if not r or r.status_code != 200:
            status = getattr(r, "status_code", "no response")
            return {"user_id": user_id, "videos": [], "count": 0, "page": page_num, "error": f"HTTP {status}"}
        ids = extract_video_ids(r.text)
        return {"user_id": user_id, "videos": ids, "count": len(ids), "page": page_num}


def action_download_url(scraper, video_id: str, quality: str = "1080p"):
    info = action_video_info(scraper, video_id)
    if "error" in info:
        return {"error": info["error"]}
    dl_url = info["videos"].get(quality)
    if not dl_url and info["videos"]:
        quals = sorted(info["videos"].keys(), key=quality_key, reverse=True)
        dl_url = info["videos"][quals[0]]
        quality = quals[0] if quals else quality
    if not dl_url:
        return {"error": "no download URL found"}
    return {
        "video_id": video_id, "title": info["title"], "quality": quality,
        "url": dl_url, "cover_url": info["cover_url"],
    }


class EngineHandler(BaseHTTPRequestHandler):
    scraper = None
    _last_proxy = None
    _last_request_time = 0.0  # Rate limiter: last hanime1.me request timestamp
    _min_request_gap = 1.5    # Minimum seconds between requests to avoid rate limiting

    # In-memory cache for video_info (avoids repeated cloudscraper calls for thumbnails)
    _video_cache = {}
    _cache_time = {}
    CACHE_TTL = 300  # 5 minutes

    @classmethod
    def _rate_limit(cls):
        """Ensure minimum gap between hanime1.me requests to avoid rate limiting."""
        now = time.time()
        elapsed = now - cls._last_request_time
        if elapsed < cls._min_request_gap:
            wait = cls._min_request_gap - elapsed
            print(f"[engine] rate limiting: waiting {wait:.1f}s", file=sys.stderr, flush=True)
            time.sleep(wait)
        cls._last_request_time = time.time()

    def _cached_video_info(self, video_id: str):
        now = time.time()
        if video_id in self._video_cache and (now - self._cache_time.get(video_id, 0)) < self.CACHE_TTL:
            return self._video_cache[video_id]
        info = action_video_info(self.scraper, video_id)
        # Only cache successful results (don't cache errors/retries)
        if "error" not in info:
            self._video_cache[video_id] = info
            self._cache_time[video_id] = now
        return info

    def _ensure_scraper(self):
        current_proxy = _get_proxy()
        if self.scraper is None or current_proxy != self._last_proxy:
            self.scraper = create_scraper()
            self._last_proxy = current_proxy

    def do_POST(self):
        self._ensure_scraper()
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            request = json.loads(body)
        except json.JSONDecodeError as e:
            self._respond({"error": f"invalid JSON: {e}"}, 400)
            return

        action = request.get("action", "")
        result = {"action": action}
        try:
            if action == "user_playlists":
                result.update(action_user_playlists(self.scraper, request.get("user_id", "")))
            elif action == "user_name":
                uid = request.get("user_id", "")
                try:
                    result.update(action_user_profile(self.scraper, uid))
                except Exception as e:
                    result["name"] = f"User {uid}"
                    result["avatar"] = ""
                    result["error"] = str(e)
            elif action == "user_profile":
                uid = request.get("user_id", "")
                result.update(action_user_profile(self.scraper, uid))
            elif action == "video_tags":
                vid = request.get("video_id", "")
                try:
                    self._rate_limit()
                    tags, desc = [], ""
                    for url, label in [
                        (f"{BASE_URL}/watch?v={vid}", f"video_tags_watch {vid}"),
                        (f"{BASE_URL}/download?v={vid}", f"video_tags_download {vid}"),
                    ]:
                        r = fetch_page(self.scraper, url, label, timeout=15, min_len=200)
                        if r and r.status_code == 200:
                            tags, desc = extract_video_details(r.text)
                            if tags or desc:
                                break
                    result["tags"] = tags
                    result["description"] = desc
                except Exception as e:
                    result["tags"] = []
                    result["description"] = ""
                    result["error"] = str(e)
            elif action == "health":
                try:
                    r = self.scraper.get(f"{BASE_URL}/", timeout=15)
                    result["status"] = f"HTTP {r.status_code}"
                    result["body_len"] = len(r.text)
                except Exception as e:
                    result["status"] = f"error: {e}"
            elif action == "playlist_videos":
                self._rate_limit()
                result.update(action_playlist_videos(self.scraper, request.get("playlist_id", "")))
            elif action == "video_info":
                vid = request.get("video_id", "")
                self._rate_limit()
                result.update(self._cached_video_info(vid))
            elif action == "user_uploaded":
                self._rate_limit()
                result.update(action_user_uploaded(self.scraper, request.get("user_id", ""), request.get("page", 1)))
            elif action == "cover":
                video_id = request.get("video_id", "")
                info = self._cached_video_info(video_id)
                for cover_url in cover_candidates(self.scraper, video_id, info):
                    r = self.scraper.get(cover_url, headers={"Referer": f"{BASE_URL}/"}, timeout=15)
                    ctype = r.headers.get("Content-Type", "image/jpeg")
                    if r.status_code == 200 and ("image" in ctype or len(r.content) > 1024):
                        self.send_response(200)
                        self.send_header("Content-Type", ctype)
                        self.send_header("Cache-Control", "public, max-age=86400")
                        self.send_header("Content-Length", str(len(r.content)))
                        self.end_headers()
                        self.wfile.write(r.content)
                        return
                result["error"] = "cover not found"
            elif action == "download_url":
                result.update(action_download_url(self.scraper, request.get("video_id", ""), request.get("quality", "1080p")))
            else:
                result["error"] = f"unknown action: {action}"
        except Exception as e:
            result["error"] = str(e)

        self._respond(result)

    def _respond(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        sys.stderr.write(f"[engine] {args[0]} {args[1]} {args[2]}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    server = HTTPServer(("0.0.0.0", port), EngineHandler)
    print(f"[engine] HTTP engine ready on port {port} (cloudscraper {cloudscraper.__version__})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
