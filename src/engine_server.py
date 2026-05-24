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
from http.server import HTTPServer, BaseHTTPRequestHandler

import cloudscraper

warnings.filterwarnings("ignore")

MAX_RETRIES = 5
RETRY_DELAY = 3
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
    return re.sub(r'[\\/:*?"<>|]', '_', name).strip()[:200]


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
        ids.update(re.findall(r'href="[^"]*watch\?v=(\d+)"', html))
    # Pattern 3: Any occurrence of /watch?v=ID in href or onclick
    if not ids:
        ids.update(re.findall(r'watch\?v=(\d+)', html))
    # Pattern 4: data-id or data-video attributes
    if not ids:
        ids.update(re.findall(r'data-(?:id|video)[= ]*["\']?(\d+)', html))
    return sorted(ids)


def action_user_playlists(scraper, user_id: str):
    url = f"{BASE_URL}/user/{user_id}/playlists"
    r = scraper.get(url, timeout=30)
    print(f"[engine] user_playlists {user_id}: HTTP {r.status_code} len={len(r.text)}", file=sys.stderr, flush=True)
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}", "playlists": []}
    playlist_ids = sorted(set(re.findall(
        r'href="https://hanime1\.me/playlist\?list=(\d+)"', r.text)))
    titles = re.findall(r'<div title="([^"]*)"', r.text)
    playlists = []
    for i, pid in enumerate(playlist_ids):
        title = titles[i] if i < len(titles) else f"playlist_{pid}"
        playlists.append({"id": pid, "title": title, "safe_title": clean_name(title)})
    return {"playlists": playlists, "total": len(playlists)}


def action_playlist_videos(scraper, playlist_id: str):
    url = f"{BASE_URL}/playlist?list={playlist_id}"
    for i in range(MAX_RETRIES):
        r = scraper.get(url, timeout=30)
        print(f"[engine] playlist_videos {playlist_id} attempt {i+1}: HTTP {r.status_code} len={len(r.text)}", file=sys.stderr, flush=True)
        if r.status_code == 200:
            ids = extract_video_ids(r.text)
            print(f"[engine] playlist_videos {playlist_id}: extracted {len(ids)} video IDs", file=sys.stderr, flush=True)
            if not ids and len(r.text) < 30000 and i < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
                continue
            if not ids:
                # Debug: check what patterns exist in the HTML
                sample = r.text[-2000:] if len(r.text) > 2000 else r.text
                hrefs = re.findall(r'href="([^"]+)"', sample)[:10]
                print(f"[engine] playlist_videos {playlist_id}: no IDs found, sample hrefs: {hrefs}", file=sys.stderr, flush=True)
            return {"playlist_id": playlist_id, "videos": ids, "count": len(ids)}
        elif r.status_code != 200 and i < MAX_RETRIES - 1:
            time.sleep(RETRY_DELAY)
    return {"playlist_id": playlist_id, "videos": [], "count": 0, "error": "failed after retries"}


def action_video_info(scraper, video_id: str):
    url = f"{BASE_URL}/download?v={video_id}"
    for i in range(MAX_RETRIES):
        r = scraper.get(url, timeout=30)
        print(f"[engine] video_info {video_id} attempt {i+1}: HTTP {r.status_code} len={len(r.text)}", file=sys.stderr, flush=True)
        if r.status_code == 200:
            title_match = re.search(r'<h3[^>]*>(.*?)</h3>', r.text, re.DOTALL)
            title = title_match.group(1).strip() if title_match else f"video_{video_id}"
            img_match = re.search(r'<img[^>]*class="download-image"[^>]*src="([^"]+)"', r.text)
            cover_url = img_match.group(1) if img_match else ""
            links = re.findall(r'<a[^>]*data-url="([^"]+)"[^>]*>(.*?)</a>', r.text, re.DOTALL)
            videos = {}
            for data_url, link_html in links:
                data_url = data_url.replace('&amp;', '&')
                q_match = re.search(r'-(\d+p)\.', data_url)
                quality = q_match.group(1) if q_match else "unknown"
                videos[quality] = data_url
            if not videos:
                hrefs = re.findall(r'<a[^>]*href="(https://[^"]+\.(mp4|m3u8)[^"]*)"[^>]*>', r.text)
                for j, du in enumerate(list(set(h[0] for h in hrefs))):
                    q_match = re.search(r'-(\d+p)\.', du)
                    quality = q_match.group(1) if q_match else f"link_{j}"
                    videos[quality] = du
            return {
                "video_id": video_id, "title": title, "safe_title": clean_name(title),
                "cover_url": cover_url, "videos": videos,
                "qualities": sorted(videos.keys(), key=lambda x: int(x.replace('p', '')), reverse=True),
            }
        elif r.status_code == 429:
            wait = int(r.headers.get("Retry-After", RETRY_DELAY))
            print(f"  rate limited, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
        else:
            if i < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
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
            r = scraper.get(url, timeout=30)
            if r.status_code != 200:
                break
            ids = set(re.findall(r'href="https://hanime1\.me/watch\?v=(\d+)"', r.text))
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
        r = scraper.get(url, timeout=30)
        if r.status_code != 200:
            return {"user_id": user_id, "videos": [], "count": 0, "page": page_num, "error": f"HTTP {r.status_code}"}
        ids = sorted(set(re.findall(r'href="https://hanime1\.me/watch\?v=(\d+)"', r.text)))
        return {"user_id": user_id, "videos": ids, "count": len(ids), "page": page_num}


def action_download_url(scraper, video_id: str, quality: str = "1080p"):
    info = action_video_info(scraper, video_id)
    if "error" in info:
        return {"error": info["error"]}
    dl_url = info["videos"].get(quality)
    if not dl_url and info["videos"]:
        quals = sorted(info["videos"].keys(), key=lambda x: int(x.replace('p', '')), reverse=True)
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

    # In-memory cache for video_info (avoids repeated cloudscraper calls for thumbnails)
    _video_cache = {}
    _cache_time = {}
    CACHE_TTL = 300  # 5 minutes

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
                    r = self.scraper.get(f"{BASE_URL}/user/{uid}/uploaded", timeout=15)
                    if r.status_code == 200:
                        m = re.search(r"<h3[^>]*>(.*?)</h3>", r.text)
                        name = m.group(1).strip() if m else f"User {uid}"
                        result["name"] = name
                        result["user_id"] = uid
                    else:
                        result["name"] = f"User {uid}"
                except Exception as e:
                    result["name"] = f"User {uid}"
                    result["error"] = str(e)
            elif action == "video_tags":
                vid = request.get("video_id", "")
                try:
                    r = self.scraper.get(f"{BASE_URL}/watch?v={vid}", timeout=15)
                    if r.status_code == 200:
                        tags = re.findall(r'<a[^>]*href="[^"]*tag[^"]*"[^>]*>(.*?)</a>', r.text, re.DOTALL)
                        if not tags:
                            tags = re.findall(r'<a[^>]*class="[^"]*badge[^"]*"[^>]*>(.*?)</a>', r.text, re.DOTALL)
                        desc_match = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]*)"', r.text)
                        result["tags"] = [t.strip() for t in tags if t.strip()][:10]
                        result["description"] = desc_match.group(1).strip()[:500] if desc_match else ""
                    else:
                        result["tags"] = []
                        result["description"] = ""
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
                result.update(action_playlist_videos(self.scraper, request.get("playlist_id", "")))
            elif action == "video_info":
                vid = request.get("video_id", "")
                result.update(self._cached_video_info(vid))
            elif action == "user_uploaded":
                result.update(action_user_uploaded(self.scraper, request.get("user_id", ""), request.get("page", 1)))
            elif action == "cover":
                video_id = request.get("video_id", "")
                info = self._cached_video_info(video_id)
                if info.get("cover_url"):
                    r = self.scraper.get(info["cover_url"], headers={"Referer": f"{BASE_URL}/"})
                    if r.status_code == 200:
                        self.send_response(200)
                        self.send_header("Content-Type", r.headers.get("Content-Type", "image/jpeg"))
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
