# hanime-web v5

hanime1.me video browser & downloader. Dark tech aesthetic, SSR + HTMX, built-in login, proxy config, RSS subscriptions, and remote storage (WebDAV/SMB/FTP).

## Requirements

- Bun >= 1.2
- Python >= 3.10 (for engine)
- A proxy (HTTP or SOCKS5) to reach hanime1.me — configurable from the web UI

## Quick Start

```bash
git clone https://github.com/JUUCHEN1/haime1-web.git
cd haime1-web
bun install

export ADMIN_PASSWORD="your-strong-password"

# Start engine
python3 src/engine_server.py &

# Start web server
bun --hot src/server.ts
```

Open `http://localhost:3280/login` — enter admin password, then configure proxy in Settings.

## Architecture

```
Browser ──► :3280 (Bun + HTMX) ──► :5001 (Python engine) ──► proxy ──► hanime1.me
                                       │
                                       ▼
                                  /app/data/ (configs)
```

| File | Role |
|------|------|
| `src/server.ts` | Web server, HTML templates, routes, auth, all config |
| `src/styles.css` | Design system (Geist, dark theme, CSS spring physics) |
| `src/engine.ts` | TypeScript bridge to Python engine |
| `src/engine_server.py` | Python engine — video info, covers, proxy, cache |
| `src/download.ts` | Download queue manager (hanime-dl-lite backed) |
| `hanime-dl-lite` | Python downloader binary (cloudscraper) |
| `hanime-dl-lite-package/` | Parent repo for downloader |
| `Dockerfile` | Multi-stage Docker image (Python + Bun + Supervisor) |
| `docker-compose.yml` | Docker Compose service definition |
| `supervisord.conf` | Supervisor process manager config |

## Features

- **Login portal** — HMAC-signed cookie sessions, 24h expiry, all routes protected
- **Proxy config** — HTTP / SOCKS5 proxy settings, saved to `/app/data/proxy-config.json`
- **DC Download Center** — search by URL/ID, preview video info, select quality, one-click download
- **Video detail page** — tags, description, cover, quality selector, collapsible metadata
- **User browser** — view playlists and uploaded videos per author
- **Playlist browser** — paginated video list with quality + download per item
- **Quality selector** — dynamic: only shows qualities available from hanime1.me
- **Download queue** — spawns hanime-dl-lite, error handling, cancel/clear
- **Download progress bar** — HTMX-polled per-task progress indicator
- **Download feedback** — alert() notification on queue success/failure
- **RSS subscriptions** — configurable refresh interval (1h/3h/6h/12h/24h/off), dashboard
- **Remote storage** — WebDAV/SMB/FTP/local, auto-transfer after download, connectivity test
- **Direct to remote** — skip local disk, transfer then delete local copy
- **i18n** — Chinese / English toggle (cookie-based, all UI text)
- **Dark theme** — Geist fonts, geometric grid, staggered animations, responsive mobile nav
- **Config persistence** — all settings in `/app/data/`, Docker volume-safe (EISDIR fix)
- **Engine cache** — 5-min TTL for video_info, only caches successful results

## Authentication

A login page (`/login`) guards the entire app. All routes redirect to `/login` unless a valid `auth` cookie is present. The cookie contains a timestamp + HMAC-SHA256 signature, HTTPOnly, valid for 24 hours.

```bash
export ADMIN_PASSWORD="my-secure-password"
```

Defaults to `admin` if not set. No first-time setup wizard. Logout via sidebar link clears cookie.

## Proxy Configuration

Navigate to **Settings** → Proxy section. At least one proxy must be set for the engine to reach hanime1.me. Settings saved to `/app/data/proxy-config.json` — takes effect immediately.

## Remote Storage

Navigate to **Settings** → Storage section. Supports:

| Protocol | Test Command | Transfer Command |
|----------|-------------|-----------------|
| Local | skip | cp |
| WebDAV | `curl -X PROPFIND` | `curl -T` |
| SMB/CIFS | `smbclient -L` | `smbclient put` |
| FTP | `curl -s` | `curl -T` |

After download completes, files are automatically transferred to remote storage. Enable "Direct to remote" to delete local copies after transfer. Use **Test Connection** button to verify connectivity before saving.

## RSS Subscriptions

Navigate to **RSS** page → Dashboard. Configure refresh interval in Settings. The server periodically checks hanime1.me for new uploads from subscribed authors and displays them in the dashboard.

## Docker Deployment

### Quick Deploy

```bash
git clone https://github.com/JUUCHEN1/haime1-web.git
cd haime1-web
export ADMIN_PASSWORD="your-strong-password"
docker compose up -d --build
docker compose logs -f
```

### Volumes

| Path | Description |
|------|-------------|
| `./data` | All persistent config (proxy, storage, RSS, session) |
| `./downloads` | Video download output |

### Environment Variables

| Env | Default | Description |
|-----|---------|-------------|
| `PORT` | `3280` | Web server port |
| `ADMIN_PASSWORD` | `admin` | Login password |
| `SESSION_SECRET` | random | HMAC signing key for auth cookies |
| `DL_DIR` | `/downloads` | Download output directory |
| `HANIME_BIN` | `/app/hanime-dl-lite` | Downloader binary path |
| `ENGINE_URL` | `http://127.0.0.1:5001` | Python engine URL |

### Troubleshooting

- **Engine can't reach hanime1.me**: configure HTTP/SOCKS5 proxy in Settings
- **Locked out**: restart container with new `ADMIN_PASSWORD`
- **Port conflict**: change `3280:3280` to e.g. `3281:3280`
- **EISDIR errors**: ensure `./data` is mounted as directory, not individual files
- **Download no feedback**: not a bug — uses `alert()` popup; check browser allows popups
- **WebDAV 404**: clear the "Remote Path" field to `/`, save, then test

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/login` | GET | Login page |
| `/api/login` | POST | Submit password, get auth cookie |
| `/api/logout` | GET | Clear auth cookie |
| `/settings` | GET | Settings page (proxy, RSS, storage) |
| `/api/proxy` | POST | Save proxy config |
| `/api/storage` | POST | Save storage config |
| `/api/storage/test` | POST | Test storage connectivity |
| `/api/rss-interval` | POST | Set RSS refresh interval |
| `/api/rss/dashboard` | GET | RSS dashboard HTML fragment |
| `/` | GET | Home (Bento grid) |
| `/dc/video` | GET | DC single video page |
| `/dc/user` | GET | DC user page |
| `/api/dc/preview/video/:id` | GET | Video preview HTML fragment |
| `/api/dc/preview/user/:id` | GET | User playlists preview |
| `/api/dl/video/:id` | POST | Queue video download |
| `/api/dl/playlist/:id` | POST | Queue playlist download |
| `/api/dl/user/:id` | POST | Queue all user works |
| `/api/dlstatus` | GET | Download queue HTML fragment (progress bars) |
| `/api/dlcancel/:id` | POST | Cancel download |
| `/api/dlclear` | POST | Clear completed downloads |
| `/api/cover/:id` | GET | Cover image proxy |
| `/api/video/title/:id` | GET | Lazy-load video title |
| `/api/video/tags/:id` | GET | Lazy-load video tags |
| `/play/:id` | GET | Video player page |
| `/video/:id` | GET | Video detail page |
| `/user/:id/playlists` | GET | User playlists |
| `/playlist/:id` | GET | Playlist videos |
| `/downloads` | GET | Download management page |
| `/rss` | GET | RSS subscription page |
